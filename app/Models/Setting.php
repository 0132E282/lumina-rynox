<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Setting extends Model
{
    protected $fillable = [
        'key',
        'value',
    ];

    public static function get(string $key, mixed $default = null): mixed
    {
        $raw = static::query()->where('key', $key)->value('value');

        return $raw === null ? $default : json_decode($raw, true);
    }

    public static function set(string $key, mixed $value): void
    {
        static::query()->updateOrCreate(['key' => $key], ['value' => json_encode($value)]);
    }

    /**
     * @param  array<int, string>  $keys
     * @return array<string, mixed>
     */
    public static function many(array $keys): array
    {
        return static::query()
            ->whereIn('key', $keys)
            ->pluck('value', 'key')
            ->map(fn ($raw) => json_decode($raw, true))
            ->all();
    }
}
