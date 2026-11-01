<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

/**
 * * Turns `rules()` into a field => constraints map for the frontend Zod schema.
 * ! Object rules (e.g. `Rule::unique()`) are dropped — only the server enforces them.
 */
class RuleSchemaConverter
{
    /**
     * * Fills fields `rules()` doesn't cover from the DB schema (type, nullability); `rules()` wins on overlap.
     *
     * @return array<string, array{required?: bool, type?: string, min?: int, max?: int, in?: array<string>, email?: bool}>
     */
    public static function forModel(string $modelClass): array
    {
        /** @var Model $model */
        $model = new $modelClass;

        $fromColumns = static::fromTable($model->getTable(), $model->getKeyName(), array_merge(
            $model->getHidden(),
            ['created_at', 'updated_at', 'deleted_at'],
        ));

        $fromRules = method_exists($modelClass, 'rules') ? static::convert($modelClass::rules()) : [];

        return array_replace_recursive($fromColumns, $fromRules);
    }

    /**
     * @param  array<string>  $excludedColumns
     * @return array<string, array{required?: bool, type?: string}>
     */
    protected static function fromTable(string $table, string $keyColumn, array $excludedColumns): array
    {
        $schema = [];

        foreach (Schema::getColumns($table) as $column) {
            $name = $column['name'];

            if ($name === $keyColumn || in_array($name, $excludedColumns, true)) {
                continue;
            }

            $type = static::mapColumnType($column['type_name']);

            if (! $type) {
                continue;
            }

            $schema[$name] = ['type' => $type, 'required' => ! $column['nullable']];
        }

        return $schema;
    }

    protected static function mapColumnType(string $dbType): ?string
    {
        return match (true) {
            str_contains($dbType, 'int') => 'integer',
            in_array($dbType, ['decimal', 'float', 'double'], true) => 'number',
            in_array($dbType, ['bool', 'boolean'], true) => 'boolean',
            in_array($dbType, ['json'], true) => 'array',
            in_array($dbType, ['varchar', 'char', 'text', 'longtext', 'mediumtext', 'string'], true) => 'string',
            default => null,
        };
    }

    /**
     * @param  array<string, array|string>  $rules
     * @return array<string, array{required?: bool, type?: string, min?: int, max?: int, in?: array<string>, email?: bool}>
     */
    public static function convert(array $rules): array
    {
        $schema = [];

        foreach ($rules as $field => $fieldRules) {
            $fieldRules = is_array($fieldRules) ? $fieldRules : explode('|', $fieldRules);
            $descriptor = [];

            foreach ($fieldRules as $rule) {
                if (! is_string($rule)) {
                    continue;
                }

                [$name, $parameter] = str_contains($rule, ':') ? explode(':', $rule, 2) : [$rule, null];

                match ($name) {
                    'required' => $descriptor['required'] = true,
                    'nullable' => $descriptor['required'] = false,
                    'string' => $descriptor['type'] = 'string',
                    'integer' => $descriptor['type'] = 'integer',
                    'numeric' => $descriptor['type'] = 'number',
                    'boolean' => $descriptor['type'] = 'boolean',
                    'array' => $descriptor['type'] = 'array',
                    'email' => $descriptor['email'] = true,
                    'min' => $descriptor['min'] = (int) $parameter,
                    'max' => $descriptor['max'] = (int) $parameter,
                    'in' => $descriptor['in'] = explode(',', (string) $parameter),
                    default => null,
                };
            }

            if ($descriptor) {
                $schema[$field] = $descriptor;
            }
        }

        return $schema;
    }
}
