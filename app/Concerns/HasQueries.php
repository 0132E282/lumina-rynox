<?php

declare(strict_types=1);

namespace App\Concerns;

use App\Support\ResourceResolver;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

trait HasQueries
{
    protected function resolveModelClass(string $resource): string
    {
        $modelClass = ResourceResolver::resolve($resource);

        if ($modelClass === null) {
            throw new NotFoundHttpException("Resource [{$resource}] not found.");
        }

        return $modelClass;
    }

    /** @param class-string<Model> $modelClass */
    protected function findByIdOrSlug(string $modelClass, string $idOrSlug): Model
    {
        if (ctype_digit($idOrSlug)) {
            return $modelClass::query()->findOrFail($idOrSlug);
        }

        return $modelClass::query()->where('slug', $idOrSlug)->firstOrFail();
    }

    protected function query(string $resource, ?Builder $base = null): Builder
    {
        $modelClass = $this->resolveModelClass($resource);

        return $base ?? $modelClass::query();
    }

    protected function queryParams(Request $request): array
    {
        return $request->all();
    }
}
