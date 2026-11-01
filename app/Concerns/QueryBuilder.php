<?php

declare(strict_types=1);

namespace App\Concerns;

use App\Support\LruCache;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Schema;
use ReflectionClass;
use Throwable;

trait QueryBuilder
{
    /** * Per-class LRU of `Schema::getColumnListing()` by table, bounded for long-running workers. */
    private static ?LruCache $columnListingCache = null;

    public function scopeApplyQuery(Builder $query, array $params): Builder|LengthAwarePaginator|Collection
    {
        [$columns, $localeOverrides] = $this->splitFieldDirectives($params['fields'] ?? null);
        $locale = $params['locale'] ?? app()->getLocale();

        $this->applyFields($query, $columns);
        // * The admin tables send `filter`; `filters` is the original key.
        $this->applyFilters($query, $params['filters'] ?? $params['filter'] ?? []);
        $this->applySearch($query, $params['search'] ?? null, (array) ($params['searchFields'] ?? []), $locale);
        $this->applySort($query, $params['sorts'] ?? $params['sort'] ?? null);

        $resolve = function () use ($query, $params, $locale, $localeOverrides) {
            $result = $this->applyPagination($query, $params);
            $this->applyTranslatable($result, $locale, $localeOverrides);

            return $result;
        };

        if (in_array(Cacheable::class, class_uses_recursive(static::class), true)) {
            return $this->rememberQuery($params, $resolve);
        }

        return $resolve();
    }

    /** * Single-record variant; lists resolve per row in `scopeApplyQuery()`. */
    public function resolveTranslatable(?string $locale = null): static
    {
        $this->applyTranslatable([$this], $locale ?? app()->getLocale(), []);

        return $this;
    }

    /**
     * * Splits `fields[]` into real columns and `field->locale` directives.
     *
     * @return array{0: ?array, 1: array<string, string>}
     */
    protected function splitFieldDirectives(?array $fields): array
    {
        $columns = [];
        $localeOverrides = [];

        foreach ($fields ?? [] as $field) {
            if (str_contains($field, '->')) {
                [$column, $target] = explode('->', $field, 2);
                $localeOverrides[$column] = $target;
                // * The directive only picks the locale — the column must still be selected.
                $columns[] = $column;
            } else {
                $columns[] = $field;
            }
        }

        return [$columns ?: null, $localeOverrides];
    }

    protected function applyFields(Builder|Relation $query, ?array $fields): void
    {
        if (! $fields) {
            return;
        }

        $columns = [];
        $relations = [];

        foreach ($fields as $field) {
            if (str_contains($field, '.')) {
                [$relation, $relationField] = explode('.', $field, 2);
                $relations[$relation][] = $relationField === '*' ? null : $relationField;
            } else {
                $columns[] = $field;
            }
        }

        $model = $query->getModel();
        $table = $model->getTable();
        $tableColumns = (self::$columnListingCache ??= new LruCache)->get($table, fn () => Schema::getColumnListing($table));

        $this->ensureBelongsToKeys($model, $relations, $columns, $tableColumns);

        if ($columns) {
            $realColumns = array_filter($columns, fn ($column) => in_array($column, $tableColumns, true));

            if ($realColumns) {
                $query->addSelect($realColumns);
            }
        }

        foreach ($relations as $relation => $relationFields) {
            $this->eagerLoadRelation($query, $model, $relation, $relationFields);
        }
    }

    protected function ensureBelongsToKeys(Model $model, array $relations, array &$columns, array $tableColumns): void
    {
        foreach ($relations as $relation => $relationFields) {
            if (! method_exists($model, $relation)) {
                continue;
            }

            try {
                $instance = $model->$relation();

                if ($instance instanceof BelongsTo) {
                    $foreignKey = $instance->getForeignKeyName();
                    if (! in_array($foreignKey, $columns, true) && in_array($foreignKey, $tableColumns, true)) {
                        $columns[] = $foreignKey;
                    }
                    if ($instance instanceof MorphTo) {
                        $morphType = $instance->getMorphType();
                        if (! in_array($morphType, $columns, true) && in_array($morphType, $tableColumns, true)) {
                            $columns[] = $morphType;
                        }
                    }
                } else {
                    $ownerKey = method_exists($instance, 'getLocalKeyName')
                        ? $instance->getLocalKeyName()
                        : $model->getKeyName();

                    if (! in_array($ownerKey, $columns, true) && in_array($ownerKey, $tableColumns, true)) {
                        $columns[] = $ownerKey;
                    }
                }
            } catch (Throwable) {
            }
        }
    }

    protected function eagerLoadRelation(Builder|Relation $query, Model $model, string $relation, array $relationFields): void
    {
        $hasWildcard = in_array(null, $relationFields, true);
        $nonNullFields = array_values(array_filter($relationFields, fn ($f) => $f !== null));

        $query->with([$relation => function ($q) use ($model, $relation, $relationFields, $hasWildcard, $nonNullFields) {
            try {
                $instance = method_exists($model, $relation) ? $model->$relation() : null;
                $relatedModel = $q->getModel();
                $extraFields = [$relatedModel->getKeyName()];

                if ($instance) {
                    if (method_exists($instance, 'getForeignKeyName') && ! ($instance instanceof BelongsTo)) {
                        $extraFields[] = $instance->getForeignKeyName();
                    }
                    if (method_exists($instance, 'getMorphType') && ! ($instance instanceof MorphTo)) {
                        $extraFields[] = $instance->getMorphType();
                    }
                }

                if ($hasWildcard) {
                    if ($nonNullFields) {
                        $this->applyFields($q, $nonNullFields);
                    }
                } else {
                    $this->applyFields($q, array_unique(array_merge($extraFields, $relationFields)));

                    $requestedFields = array_filter($relationFields, fn ($f) => is_string($f) && ! str_contains($f, '.'));
                    $injectedFields = array_diff($extraFields, $requestedFields);
                    if ($injectedFields) {
                        $q->afterQuery(function ($models) use ($injectedFields) {
                            foreach ($models as $m) {
                                $m->makeHidden($injectedFields);
                            }
                        });
                    }
                }
            } catch (Throwable) {
                if ($nonNullFields) {
                    $this->applyFields($q, $nonNullFields);
                }
            }
        }]);
    }

    /**
     * * Resolves `$translatable` fields to the target locale, or keeps the raw map for `toRaw`.
     * * Dot-path entries (e.g. `metadata.title`) resolve a locale map nested inside a JSON column.
     */
    protected function applyTranslatable(mixed $result, string $locale, array $localeOverrides): void
    {
        $items = $result instanceof LengthAwarePaginator ? $result->items() : $result;

        if (! is_iterable($items)) {
            return;
        }

        foreach ($items as $model) {
            if ($model instanceof Model) {
                $this->transformModelTranslatable($model, $locale, $localeOverrides);
            }
        }
    }

    protected function transformModelTranslatable(Model $model, string $locale, array $localeOverrides): void
    {
        $translatable = $this->getModelTranslatable($model);

        if (! empty($translatable)) {
            $plainFields = [];
            $nestedByColumn = [];

            foreach ($translatable as $field) {
                $target = $localeOverrides[$field] ?? $locale;

                if (str_contains($field, '.')) {
                    [$column, $key] = explode('.', $field, 2);
                    $nestedByColumn[$column][$key] = $target;
                } else {
                    $plainFields[$field] = $target;
                }
            }

            $updates = [];

            foreach ($plainFields as $field => $target) {
                if (! array_key_exists($field, $model->getAttributes())) {
                    continue;
                }

                $original = $model->getAttributes()[$field] ?? $model->getRawOriginal($field);
                $raw = json_decode($original ?? '', true);

                if (is_array($raw)) {
                    if ($target === 'toRaw') {
                        $updates[$field] = $raw;
                    } else {
                        $updates[$field] = $raw[$target] ?? $raw[app()->getLocale()] ?? reset($raw) ?: null;
                    }
                } else {
                    $updates[$field] = $original;
                }
            }

            foreach ($nestedByColumn as $column => $keys) {
                if (! array_key_exists($column, $model->getAttributes())) {
                    continue;
                }

                $originalColumn = $model->getAttributes()[$column] ?? $model->getRawOriginal($column);
                $parent = json_decode($originalColumn ?? '', true) ?: [];

                foreach ($keys as $key => $target) {
                    $sub = is_array($parent[$key] ?? null) ? $parent[$key] : [];
                    $parent[$key] = $target === 'toRaw' ? $sub : ($sub[$target] ?? $sub[app()->getLocale()] ?? reset($sub) ?: null);
                }

                $updates[$column] = json_encode($parent);
            }

            if (! empty($updates)) {
                $model->setRawAttributes($updates + $model->getAttributes());
            }
        }

        foreach ($model->getRelations() as $relationValue) {
            if (! $relationValue) {
                continue;
            }

            if ($relationValue instanceof Model) {
                $this->transformModelTranslatable($relationValue, $locale, $localeOverrides);
            } elseif (is_iterable($relationValue)) {
                foreach ($relationValue as $relItem) {
                    if ($relItem instanceof Model) {
                        $this->transformModelTranslatable($relItem, $locale, $localeOverrides);
                    }
                }
            }
        }
    }

    protected function getModelTranslatable(Model $model): array
    {
        if (method_exists($model, 'getTranslatableFields')) {
            return (array) $model->getTranslatableFields();
        }

        try {
            $ref = new ReflectionClass($model);
            if ($ref->hasProperty('translatable')) {
                $prop = $ref->getProperty('translatable');
                $prop->setAccessible(true);

                return (array) $prop->getValue($model);
            }
        } catch (Throwable) {
        }

        return [];
    }

    /**
     * ! Incoming translatable values are one locale's text: merge them into the stored map instead of overwriting.
     *
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function mergeTranslatableInput(array $input, string $locale): array
    {
        $locales = config('app.locales', []);
        if (count($locales) <= 1) {
            return $input;
        }

        foreach ($this->translatable ?? [] as $field) {
            if (str_contains($field, '.')) {
                [$column, $key] = explode('.', $field, 2);
                $value = $input[$column][$key] ?? null;

                if (! is_string($value)) {
                    continue;
                }

                $existing = json_decode($this->getRawOriginal($column) ?? '', true);
                $map = is_array($existing[$key] ?? null) ? $existing[$key] : [];
                $map[$locale] = $value;

                $input[$column][$key] = $map;

                continue;
            }

            $value = $input[$field] ?? null;

            if (! is_string($value)) {
                continue;
            }

            $map = json_decode($this->getRawOriginal($field) ?? '', true);
            $map = is_array($map) ? $map : [];
            $map[$locale] = $value;

            // * No cast on translatable columns: this is the only place that encodes their JSON.
            $input[$field] = json_encode($map);
        }

        return $input;
    }

    /**
     * * `$fulltextSearchable` fields use MATCH (needs a fulltext index); `$translatable` fields match `field->locale`;
     * * others use LIKE with `%`/`_` escaped.
     */
    protected function applySearch(Builder $query, ?string $search, array $searchFields, string $locale): void
    {
        if ($search === null || $search === '' || ! $searchFields) {
            return;
        }

        $translatable = $this->translatable ?? [];
        $fulltextSearchable = $this->fulltextSearchable ?? [];
        $escaped = addcslashes($search, '\\%_');

        $query->where(function (Builder $query) use ($search, $escaped, $searchFields, $translatable, $fulltextSearchable, $locale) {
            foreach ($searchFields as $field) {
                if (in_array($field, $fulltextSearchable, true)) {
                    $query->whereFullText($field, $search, boolean: 'or');

                    continue;
                }

                $column = in_array($field, $translatable, true) ? "{$field}->{$locale}" : $field;

                $query->orWhere($column, 'like', "%{$escaped}%");
            }
        });
    }

    protected function applyFilters(Builder $query, array $filters): void
    {
        $model = $query->getModel();

        foreach ($filters as $field => $conditions) {
            if (! is_array($conditions)) {
                continue;
            }

            if (str_contains($field, '.')) {
                [$relation, $subField] = explode('.', $field, 2);
                if (method_exists($model, $relation)) {
                    $query->whereHas($relation, function (Builder $relQuery) use ($subField, $conditions) {
                        $this->applyFilters($relQuery, [$subField => $conditions]);
                    });

                    continue;
                }
            } elseif (method_exists($model, $field) && ! in_array($field, ['id', 'status', 'name', 'slug', 'price', 'stock', 'is_featured', 'position'], true)) {
                $query->whereHas($field, function (Builder $relQuery) use ($conditions) {
                    $this->applyFilters($relQuery, $conditions);
                });

                continue;
            }

            foreach ($conditions as $operatorOrColumn => $value) {
                if (is_array($value) && ! str_starts_with($operatorOrColumn, '_') && ! in_array($operatorOrColumn, ['checked', 'unchecked', 'has', 'does_not_have'], true)) {
                    $subColumn = $operatorOrColumn;
                    foreach ($value as $op => $val) {
                        $this->applySingleFilterCondition($query, $subColumn, $op, $val);
                    }
                } else {
                    $this->applySingleFilterCondition($query, $field, $operatorOrColumn, $value);
                }
            }
        }
    }

    protected function applySingleFilterCondition(Builder $query, string $field, string $operator, mixed $value): void
    {
        if ($field === 'id' && is_string($value) && ! ctype_digit($value) && in_array($operator, ['_eq', '_in', '_like'], true)) {
            $query->where(function (Builder $q) use ($value) {
                $q->where('id', '=', $value)
                    ->orWhere('slug', '=', $value)
                    ->orWhere('slug', 'like', "%{$value}%");
            });

            return;
        }

        $this->applyFilterCondition($query, $field, $operator, $value);
    }

    protected function applyFilterCondition(Builder $query, string $field, string $operator, mixed $value): void
    {
        match ($operator) {
            '_eq' => $query->where($field, '=', $value),
            '_neq' => $query->where($field, '!=', $value),
            '_gt' => $query->where($field, '>', $value),
            '_gte' => $query->where($field, '>=', $value),
            '_lt' => $query->where($field, '<', $value),
            '_lte' => $query->where($field, '<=', $value),
            '_in' => $query->whereIn($field, (array) $value),
            '_nin' => $query->whereNotIn($field, (array) $value),
            '_like' => $query->where($field, 'like', "%{$value}%"),
            '_nlike' => $query->where($field, 'not like', "%{$value}%"),
            '_startswith' => $query->where($field, 'like', "{$value}%"),
            '_endswith' => $query->where($field, 'like', "%{$value}"),
            '_is_null' => $query->whereNull($field),
            '_is_not_null' => $query->whereNotNull($field),
            '_is_empty' => $query->where($field, '=', ''),
            '_is_not_empty' => $query->where($field, '!=', ''),
            'checked' => $query->where($field, true),
            'unchecked' => $query->where($field, false),
            'has' => $query->has($field),
            'does_not_have' => $query->doesntHave($field),
            default => null,
        };
    }

    /** @param array<int, string>|string|null $sorts `column:asc`, `column:desc`, `column` or `-column` */
    protected function applySort(Builder $query, array|string|null $sorts): void
    {
        if (! $sorts) {
            return;
        }

        $sortList = is_string($sorts) ? explode(',', $sorts) : $sorts;

        foreach ($sortList as $sort) {
            $sort = trim((string) $sort);
            if ($sort === '') {
                continue;
            }

            if (str_starts_with($sort, '-')) {
                $column = substr($sort, 1);
                $direction = 'desc';
            } elseif (str_contains($sort, ':')) {
                [$column, $dir] = explode(':', $sort, 2);
                $direction = strtolower($dir) === 'desc' ? 'desc' : 'asc';
            } else {
                $column = $sort;
                $direction = 'asc';
            }

            $query->orderBy($column, $direction);
        }
    }

    protected function applyPagination(Builder $query, array $params): mixed
    {
        $limit = (int) ($params['limit'] ?? 15);
        $paginate = ! in_array($params['paginate'] ?? true, [false, 'false', '0', 0], true);

        if ($limit === -1 || ! $paginate) {
            return $query->get();
        }

        return $query->paginate($limit, ['*'], 'page', (int) ($params['page'] ?? 1));
    }
}
