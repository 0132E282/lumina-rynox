<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Concerns\HasCrud;
use App\Concerns\HasImportExport;
use App\Concerns\HasQueries;
use App\Support\GoogleSearchConsoleService;
use App\Support\ResourceResolver;
use BackedEnum;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class ItemController extends Controller
{
    use HasCrud, HasImportExport, HasQueries;

    public function index(Request $request, string $resource): JsonResponse
    {
        DB::enableQueryLog();
        $query = $request->boolean('trashed')
            ? $this->trashedQuery($resource)
            : $this->query($resource);

        $queryParams = $this->queryParams($request);
        $queryParams['searchFields'] = $queryParams['searchFields'] ?? $this->defaultSearchFields($this->resolveModelClass($resource));

        $result = $query->applyQuery($queryParams);

        return $this->queryResultResponse($result);
    }

    /**
     * * `applySearch()` only searches the given `searchFields`; default to the model's `SEARCH_FIELDS`,
     * * else every `name`/`title`/`slug` column present.
     *
     * @return array<int, string>
     */
    protected function defaultSearchFields(string $modelClass): array
    {
        if (defined("{$modelClass}::SEARCH_FIELDS")) {
            return constant("{$modelClass}::SEARCH_FIELDS");
        }

        $table = (new $modelClass)->getTable();

        return collect(['name', 'title', 'slug'])->filter(fn ($column) => Schema::hasColumn($table, $column))->values()->all();
    }

    /**
     * * Options source, in order: the model's `{FIELD}_LIST` constant, a backed enum cast,
     * * then a relation (`category_id`, `category_ids`, `categories` → `categories` resource).
     */
    public function source(Request $request, string $resource, ?string $field = null): JsonResponse
    {
        $targetField = $field ?? $resource;

        return $this->options($request, $resource, $targetField);
    }

    public function options(Request $request, string $resource, string $field): JsonResponse
    {
        $modelClass = $this->resolveModelClass($resource);

        $listConstant = $modelClass.'::'.strtoupper($field).'_LIST';

        if (defined($listConstant)) {
            $list = constant($listConstant);
            $isLabeled = array_keys($list) !== range(0, count($list) - 1);

            return response()->json([
                // * Each entry is a label string or an array with display info (label, badge colors).
                'data' => $isLabeled
                    ? collect($list)->map(fn ($entry, $value) => is_array($entry)
                        ? ['value' => $value, ...$entry]
                        : ['value' => $value, 'label' => $entry])->values()
                    : $list,
            ]);
        }

        $enumClass = (new $modelClass)->getCasts()[$field] ?? null;

        if ($enumClass && enum_exists($enumClass) && is_subclass_of($enumClass, BackedEnum::class)) {
            return response()->json([
                'data' => collect($enumClass::cases())->map(fn ($case) => [
                    'value' => $case->value,
                    'label' => method_exists($case, 'label') ? $case->label() : $case->name,
                ]),
            ]);
        }

        $relatedModelClass = ResourceResolver::resolve($this->relatedResourceName($resource, $field));

        if (! $relatedModelClass) {
            throw new NotFoundHttpException("No option source for [{$resource}.{$field}].");
        }

        // * Label columns resolve to the requested `?locale=`, like `HasCrud::applyRequestLocale()`.
        $this->applyRequestLocale($request);

        $queryParams = $this->queryParams($request);
        $queryParams['searchFields'] = $queryParams['searchFields'] ?? $this->defaultSearchFields($relatedModelClass);

        $result = $relatedModelClass::query()->applyQuery($queryParams);
        $rows = $result instanceof LengthAwarePaginator ? collect($result->items()) : $result;

        // * A self-referencing field (e.g. related products) must not offer the record being edited.
        if ($relatedModelClass === $modelClass && $request->filled('exclude')) {
            $exclude = (string) $request->query('exclude');
            $rows = $rows->reject(fn ($row) => (string) (is_array($row) ? ($row['id'] ?? '') : ($row->id ?? '')) === $exclude);
        }

        // * Self-referencing resources (with `parent_id`) are returned as a tree for hierarchical pickers.
        $hasParentId = Schema::hasColumn((new $relatedModelClass)->getTable(), 'parent_id');

        if (! $hasParentId) {
            return response()->json([
                'data' => $rows->map(fn ($row) => [
                    'value' => (string) (is_array($row) ? ($row['id'] ?? '') : ($row->id ?? '')),
                    'label' => $this->relationLabel($row),
                ])->values(),
            ]);
        }

        $entries = $rows->map(fn ($row) => [
            'id' => is_array($row) ? ($row['id'] ?? null) : ($row->id ?? null),
            'parent_id' => is_array($row) ? ($row['parent_id'] ?? null) : ($row->parent_id ?? null),
            'value' => (string) (is_array($row) ? ($row['id'] ?? '') : ($row->id ?? '')),
            'label' => $this->relationLabel($row),
        ]);

        return response()->json(['data' => $this->buildOptionTree($entries)]);
    }

    /**
     * @param  Collection<int, array{id: int|string, parent_id: int|string|null, value: string, label: string}>  $entries
     * @return Collection<int, array{value: string, label: string, children?: array}>
     */
    protected function buildOptionTree($entries, int|string|null $parentId = null)
    {
        return $entries
            ->filter(fn ($entry) => $entry['parent_id'] == $parentId)
            ->map(function ($entry) use ($entries) {
                $children = $this->buildOptionTree($entries, $entry['id']);

                return [
                    'value' => $entry['value'],
                    'label' => $entry['label'],
                    ...($children->isNotEmpty() ? ['children' => $children->values()] : []),
                ];
            })
            ->values();
    }

    /**
     * * The model opts in with a `FRONTEND_URL` pattern (e.g. '/san-pham/{slug}') appended to `app.frontend_url`;
     * * without it the resource has no public page and this 404s.
     */
    public function frontendUrl(Request $request, string $resource, int|string $id): JsonResponse
    {
        $modelClass = $this->resolveModelClass($resource);

        if (! defined("{$modelClass}::FRONTEND_URL")) {
            throw new NotFoundHttpException("Resource [{$resource}] has no frontend URL configured.");
        }

        // * Translatable columns in the pattern must resolve for the requested `?locale=` first.
        $record = $modelClass::query()->findOrFail($id);
        $record->resolveTranslatable($request->query('locale'));
        $pattern = constant("{$modelClass}::FRONTEND_URL");

        $path = preg_replace_callback('/\{(\w+)\}/', fn ($match) => (string) ($record->{$match[1]} ?? ''), $pattern);

        return response()->json([
            'data' => ['url' => rtrim(config('app.frontend_url', config('app.url')), '/').$path],
        ]);
    }

    /** * Google index status via the Search Console URL Inspection API; 501 until `GOOGLE_SEARCH_CONSOLE_*` is configured. */
    public function indexStatus(Request $request, string $resource, int|string $id, GoogleSearchConsoleService $searchConsole): JsonResponse
    {
        if (! $searchConsole->configured()) {
            return response()->json([
                'message' => 'Google Search Console chưa được cấu hình (GOOGLE_SEARCH_CONSOLE_CREDENTIALS_PATH / GOOGLE_SEARCH_CONSOLE_SITE_URL).',
            ], 501);
        }

        $url = $this->frontendUrl($request, $resource, $id)->getData(true)['data']['url'];

        return response()->json(['data' => $searchConsole->inspect($url)]);
    }

    /** * `category_id`, `category_ids`, `categories` and `product_categories` all resolve to the `categories` resource. */
    protected function relatedResourceName(string $resource, string $field): string
    {
        $ownerPrefix = Str::singular($resource).'_';

        if (str_starts_with($field, $ownerPrefix)) {
            return Str::plural(substr($field, strlen($ownerPrefix)));
        }

        return match (true) {
            str_ends_with($field, '_ids') => Str::plural(Str::beforeLast($field, '_ids')),
            str_ends_with($field, '_id') => Str::plural(Str::beforeLast($field, '_id')),
            default => Str::plural($field),
        };
    }

    /** * Restores in place (keeps id and relations), unlike `AdminController::restore` which clones. */
    public function restore(string $resource, int|string $id): JsonResponse
    {
        $model = $this->trashedQuery($resource)->findOrFail($id);
        $model->restore();

        return response()->json(['data' => $model->fresh()]);
    }

    public function forceDestroy(string $resource, int|string $id): JsonResponse
    {
        $this->trashedQuery($resource)->findOrFail($id)->forceDelete();

        return response()->json(null, 204);
    }

    /** * Resources without SoftDeletes 404 instead of failing on a missing `deleted_at`. */
    protected function trashedQuery(string $resource): Builder
    {
        $modelClass = $this->resolveModelClass($resource);

        if (! in_array(SoftDeletes::class, class_uses_recursive($modelClass), true)) {
            throw new NotFoundHttpException("Resource [{$resource}] does not support trash.");
        }

        return $modelClass::onlyTrashed();
    }

    /** * Aggregates in PHP, not SQL, because values like `orders.total` are computed accessors. */
    public function dashboards(Request $request, string $resource): JsonResponse
    {
        $modelClass = $this->resolveModelClass($resource);

        $values = collect($request->input('cards', []))->map(function (array $card) use ($modelClass) {
            $rows = $modelClass::query()->applyQuery([
                'filter' => $card['filters'] ?? [],
                'paginate' => false,
            ]);

            return match ($card['aggregate'] ?? 'count') {
                'sum' => $rows->sum($card['field'] ?? null),
                default => $rows->count(),
            };
        });

        return response()->json(['data' => $values]);
    }

    protected function queryResultResponse(mixed $result): JsonResponse
    {
        if ($result instanceof LengthAwarePaginator) {
            return response()->json($this->attachDebugInfo([
                'data' => $result->items(),
                'meta' => [
                    'total' => $result->total(),
                    'page' => $result->currentPage(),
                    'limit' => $result->perPage(),
                ],
            ]));
        }

        return response()->json($this->attachDebugInfo([
            'data' => $result->values(),
            'meta' => ['total' => $result->count()],
        ]));
    }
}
