<?php

declare(strict_types=1);

use Illuminate\Support\Str;

if (! function_exists('model_class')) {
    function model_class(string $collection): string
    {
        return 'App\\Models\\'.Str::studly(Str::singular($collection));
    }
}
