<?php

declare(strict_types=1);

namespace App\Concerns;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Eloquent\Relations\MorphOne;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use ReflectionClass;
use ReflectionMethod;
use ReflectionNamedType;

/**
 * * Every public zero-argument method returning a `Relation` is a syncable field, matched by snake_case name
 * * (`relatedProducts()` <-> `related_products`). BelongsTo columns go through `$fillable`.
 */
trait HasRelations
{
    /** @var array<class-string, array<string, string>> field name => method name, keyed by model class */
    protected static array $relationMethodsCache = [];

    /** @return array<string, string> snake_case field name => relation method name */
    protected function discoverRelationMethods(string $modelClass): array
    {
        if (isset(static::$relationMethodsCache[$modelClass])) {
            return static::$relationMethodsCache[$modelClass];
        }

        $model = new $modelClass;
        $methods = [];

        foreach ((new ReflectionClass($modelClass))->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
            $returnType = $method->getReturnType();

            if (
                $method->getDeclaringClass()->getName() !== $modelClass
                || $method->getNumberOfParameters() > 0
                || ! $returnType instanceof ReflectionNamedType
                || $returnType->isBuiltin()
                || ! is_a($returnType->getName(), Relation::class, true)
            ) {
                continue;
            }

            $methods[Str::snake($method->getName())] = $method->getName();
        }

        return static::$relationMethodsCache[$modelClass] = $methods;
    }

    protected function syncRelations(Model $model, string $modelClass, Request $request): void
    {
        foreach ($this->discoverRelationMethods($modelClass) as $field => $method) {
            if (! $request->has($field)) {
                continue;
            }

            $relation = $model->{$method}();
            $value = $request->input($field);

            match (true) {
                $relation instanceof BelongsToMany, $relation instanceof MorphToMany => $relation->sync($this->extractIds($value)),
                $relation instanceof HasMany, $relation instanceof MorphMany => $this->syncHasMany($relation, (array) ($value ?? [])),
                $relation instanceof HasOne, $relation instanceof MorphOne => $this->syncHasOne($relation, $value),
                default => null,
            };
        }
    }

    protected function syncHasOne($relation, mixed $value): void
    {
        if ($value === null) {
            $relation->delete();

            return;
        }

        $attributes = is_array($value) ? $value : [];
        $related = $relation->getRelated();
        $keyName = $related->getKeyName();

        $reserved = array_filter([
            $keyName,
            $relation->getForeignKeyName(),
            $related->getCreatedAtColumn(),
            $related->getUpdatedAtColumn(),
            'value',
            'value_id',
            'label',
            method_exists($relation, 'getMorphType') ? $relation->getMorphType() : null,
        ]);

        $attributes = collect($attributes)->except($reserved)->toArray();

        $relation->updateOrCreate([], $attributes);
    }

    /** * Accepts a scalar id or an array with `value` / `value_id` / `id` (from `withRelations()` and `attribute-pairs`). */
    protected function extractIds(mixed $value): array
    {
        return collect((array) ($value ?? []))
            ->map(fn ($entry) => is_array($entry) ? ($entry['value'] ?? $entry['value_id'] ?? $entry['id'] ?? null) : $entry)
            ->filter()
            ->values()
            ->all();
    }

    /**
     * * Replaces the whole list: update rows by id, create new ones, delete the rest; nested relations sync recursively.
     *
     * @param  HasMany|MorphMany  $relation
     * @param  array<int, array<string, mixed>>  $rows
     */
    protected function syncHasMany($relation, array $rows): void
    {
        $related = $relation->getRelated();
        $relatedClass = get_class($related);
        $relatedRelations = $this->discoverRelationMethods($relatedClass);
        $keyName = $related->getKeyName();
        // * Round-tripped id, timestamps, foreign key and nested relations must not be written as attributes.
        $reserved = array_filter([
            $keyName,
            $relation->getForeignKeyName(),
            $related->getCreatedAtColumn(),
            $related->getUpdatedAtColumn(),
            'value',
            'value_id',
            'label',
            ...array_keys($relatedRelations),
        ]);
        $keptIds = [];

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $id = $row[$keyName] ?? null;
            $attributes = collect($row)->except($reserved)->toArray();

            $existing = $id ? $relation->clone()->whereKey($id)->first() : null;

            // ! Merge the row's translatable text into its locale map, or every other locale is overwritten.
            if (method_exists($related, 'mergeTranslatableInput')) {
                $attributes = ($existing ?? $related->newInstance())->mergeTranslatableInput($attributes, app()->getLocale());
            }

            if ($existing) {
                $relation->clone()->whereKey($id)->update($attributes);
                $child = $relation->clone()->whereKey($id)->first();
            } else {
                $child = $relation->create($attributes);
            }

            $keptIds[] = $child->getKey();

            foreach ($relatedRelations as $nestedField => $nestedMethod) {
                if (! array_key_exists($nestedField, $row)) {
                    continue;
                }

                $nestedRelation = $child->{$nestedMethod}();
                $nestedValue = $row[$nestedField];

                match (true) {
                    $nestedRelation instanceof BelongsToMany, $nestedRelation instanceof MorphToMany => $nestedRelation->sync($this->extractIds($nestedValue)),
                    $nestedRelation instanceof HasMany, $nestedRelation instanceof MorphMany => $this->syncHasMany($nestedRelation, (array) ($nestedValue ?? [])),
                    $nestedRelation instanceof HasOne, $nestedRelation instanceof MorphOne => $this->syncHasOne($nestedRelation, $nestedValue),
                    default => null,
                };
            }
        }

        $relation->clone()->whereNotIn($keyName, $keptIds)->delete();
    }

    /** * n-n relations return `{value, label}` pairs so lazily-loaded selects can show labels of selected items. */
    protected function withRelations(Model $model, string $modelClass, ?string $locale = null): array
    {
        if (method_exists($model, 'resolveTranslatable')) {
            $model->resolveTranslatable($locale);
        }

        $data = $model->toArray();

        foreach ($this->discoverRelationMethods($modelClass) as $field => $method) {
            if (! $model->relationLoaded($method)) {
                continue;
            }

            $related = $model->{$method};

            $data[$field] = match (true) {
                $related instanceof Collection || is_array($related) => collect($related)
                    ->map(function (mixed $child) use ($locale) {
                        if ($child instanceof Model) {
                            $res = $this->withRelations($child, get_class($child), $locale);
                            $res['value_id'] = $child->getKey();
                            $res['value'] = $child->getKey();

                            return $res;
                        }

                        return $child;
                    })
                    ->values(),
                $related instanceof Model => $this->withRelations($related, get_class($related), $locale),
                default => $related,
            };
        }

        return $data;
    }

    /** * Related rows aren't resolved by `resolveTranslatable()`, so a locale map falls back to the current locale. */
    protected function relationLabel(Model|array $model): string
    {
        if (is_array($model)) {
            $value = $model['name'] ?? $model['title'] ?? $model['label'] ?? $model['id'] ?? '';
            if (is_string($value) && str_starts_with(ltrim($value), '{')) {
                $value = json_decode($value, true) ?? $value;
            }
            if (is_array($value)) {
                $value = $value[app()->getLocale()] ?? collect($value)->first();
            }

            return (string) $value;
        }

        $labelKey = collect(['name', 'title', 'label'])->first(fn ($key) => array_key_exists($key, $model->getAttributes()), 'name');
        $value = $model->{$labelKey} ?? null;

        // * Translatable columns have no cast and arrive as raw JSON when not resolved on this instance.
        if (is_string($value) && str_starts_with(ltrim($value), '{')) {
            $value = json_decode($value, true) ?? $value;
        }

        if (is_array($value)) {
            $value = $value[app()->getLocale()] ?? collect($value)->first();
        }

        return (string) ($value ?? $model->getKey());
    }
}
