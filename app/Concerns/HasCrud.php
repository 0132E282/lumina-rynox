<?php

declare(strict_types=1);

namespace App\Concerns;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

trait HasCrud
{
    use HasRelations;

    public function show(Request $request, string $resource, string $idOrSlug): JsonResponse
    {
        DB::enableQueryLog();
        $modelClass = $this->resolveModelClass($resource);
        $model = $this->findByIdOrSlug($modelClass, $idOrSlug);

        return $this->respondWithModel($model, $modelClass, $request);
    }

    /** * `?locale=` also decides which locale a translatable plain-string value is written under. */
    protected function applyRequestLocale(Request $request): void
    {
        if ($locale = $request->query('locale')) {
            app()->setLocale($locale);
        }
    }

    public function store(Request $request, string $resource): JsonResponse
    {
        DB::enableQueryLog();
        $modelClass = $this->resolveModelClass($resource);
        $this->applyRequestLocale($request);

        $model = $modelClass::create($this->transform($request, $modelClass));
        $this->syncRelations($model, $modelClass, $request);

        return $this->respondWithModel($model, $modelClass, $request, 'Đã tạo mới.', 201);
    }

    public function update(Request $request, string $resource, int|string $id): JsonResponse
    {
        DB::enableQueryLog();
        $modelClass = $this->resolveModelClass($resource);
        $this->applyRequestLocale($request);

        $model = $modelClass::query()->findOrFail($id);
        $model->update($this->transform($request, $modelClass, $model));
        $this->syncRelations($model, $modelClass, $request);

        return $this->respondWithModel($model->fresh(), $modelClass, $request, 'Đã cập nhật.');
    }

    public function destroy(string $resource, int|string $id): JsonResponse
    {
        $modelClass = $this->resolveModelClass($resource);
        $modelClass::query()->findOrFail($id)->delete();

        return response()->json(null, 204);
    }

    protected function respondWithModel(Model $model, string $modelClass, Request $request, ?string $message = null, int $status = 200): JsonResponse
    {
        $this->eagerLoadRelations($model, $modelClass, $request);
        $locale = $request->query('locale');

        $payload = ['data' => $this->withRelations($model, $modelClass, $locale)];
        if ($message !== null) {
            $payload['message'] = $message;
        }

        return response()->json($this->attachDebugInfo($payload), $status);
    }

    protected function eagerLoadRelations(Model $model, string $modelClass, Request $request): void
    {
        $fieldsInput = $request->input('fields');

        if (! $fieldsInput) {
            return;
        }

        $fields = is_array($fieldsInput)
            ? $fieldsInput
            : array_map('trim', explode(',', (string) $fieldsInput));

        $relations = [];
        $discovered = $this->discoverRelationMethods($modelClass);

        foreach ($fields as $field) {
            if (! is_string($field) || $field === '') {
                continue;
            }

            if (str_contains($field, '.')) {
                $parts = explode('.', $field);
                $relParts = [];
                $currentClass = $modelClass;

                foreach ($parts as $part) {
                    if (! class_exists($currentClass)) {
                        break;
                    }

                    $disc = $this->discoverRelationMethods($currentClass);
                    if (! isset($disc[$part])) {
                        break;
                    }

                    $method = $disc[$part];
                    $relParts[] = $method;

                    try {
                        $currentClass = get_class((new $currentClass)->{$method}()->getRelated());
                    } catch (Throwable) {
                        break;
                    }
                }

                if (! empty($relParts)) {
                    $relations[] = implode('.', $relParts);
                }
            } elseif (isset($discovered[$field])) {
                $relations[] = $discovered[$field];
            }
        }

        if ($relations) {
            $model->load(array_unique($relations));
        }
    }

    protected function transform(Request $request, string $modelClass, mixed $ignoring = null): array
    {
        $input = method_exists($modelClass, 'rules') ? $request->validate($modelClass::rules($ignoring)) : $request->all();
        $input = method_exists($modelClass, 'transform') ? $modelClass::transform($input) : $input;
        $input = $this->withDefaultsForNullableColumns($input, $modelClass);

        /** @var Model $instance */
        $instance = $ignoring instanceof $modelClass ? $ignoring : new $modelClass;

        return method_exists($instance, 'mergeTranslatableInput')
            ? $instance->mergeTranslatableInput($input, app()->getLocale())
            : $input;
    }

    /**
     * * `NOT NULL DEFAULT` columns only get their default on INSERT; replace sent nulls with the DB default.
     *
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    protected function withDefaultsForNullableColumns(array $input, string $modelClass): array
    {
        /** @var Model $model */
        $model = new $modelClass;

        foreach (Schema::getColumns($model->getTable()) as $column) {
            $name = $column['name'];

            if (! $column['nullable'] && $column['default'] !== null && array_key_exists($name, $input) && $input[$name] === null) {
                $input[$name] = $column['default'];
            }
        }

        return $input;
    }

    protected function attachDebugInfo(array $payload): array
    {
        if (! app()->isProduction()) {
            $queries = DB::getQueryLog();

            $payload['debug'] = [
                'execution_time_ms' => defined('LARAVEL_START')
                    ? round((microtime(true) - LARAVEL_START) * 1000, 2)
                    : 0,
                'query_count' => count($queries),
                'memory_usage' => round(memory_get_peak_usage(true) / 1024 / 1024, 2).' MB',
            ];
        }

        return $payload;
    }
}
