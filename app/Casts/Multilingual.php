<?php

declare(strict_types=1);

namespace App\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * ! Legacy cast: new models use `$translatable` instead.
 * * Stores a `{"vi": ..., "en": ...}` map; a plain string is saved under the current locale.
 */
class Multilingual implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): mixed
    {
        if ($value === null) {
            return null;
        }

        // * `QueryBuilder::applyTranslatable()` may already have resolved the value, so only decode raw JSON strings.
        if (! is_string($value)) {
            return $value;
        }

        $decoded = json_decode($value, true);

        return json_last_error() === JSON_ERROR_NONE ? $decoded : $value;
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if ($value === null) {
            return null;
        }

        $locales = config('app.locales', []);
        if (count($locales) <= 1) {
            return is_array($value) ? (string) reset($value) : (string) $value;
        }

        if (is_array($value)) {
            return json_encode($value);
        }

        // ! A plain string is one locale's text: merge it, or every other stored locale is lost.
        $existing = json_decode($model->getRawOriginal($key) ?? '', true);
        $map = is_array($existing) ? $existing : [];
        $map[app()->getLocale()] = $value;

        return json_encode($map);
    }
}
