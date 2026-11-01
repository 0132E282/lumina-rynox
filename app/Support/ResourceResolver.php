<?php

declare(strict_types=1);

namespace App\Support;

use App\Concerns\QueryBuilder;
use Illuminate\Support\Str;

class ResourceResolver
{
    public static function resolve(string $resource): ?string
    {
        $className = Str::studly(Str::singular($resource));

        foreach (config('core.model_namespaces', []) as $namespace) {
            $candidate = rtrim($namespace, '\\').'\\'.$className;

            if (class_exists($candidate) && in_array(QueryBuilder::class, class_uses_recursive($candidate), true)) {
                return $candidate;
            }
        }

        return null;
    }
}
