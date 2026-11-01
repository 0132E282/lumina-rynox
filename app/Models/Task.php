<?php

declare(strict_types=1);

namespace App\Models;

use App\Concerns\QueryBuilder;
use Illuminate\Database\Eloquent\Model;

class Task extends Model
{
    use QueryBuilder;

    // * Read by `AuthorizeResource`: the generic items API requires `tasks.{view,create,update,delete}`.
    public const PERMISSION_RESOURCE = 'tasks';

    // * Read by `ItemController::defaultSearchFields()`.
    public const SEARCH_FIELDS = ['title', 'description'];

    public const STATUS_LIST = [
        'todo' => 'Chưa xong',
        'done' => 'Đã xong',
    ];

    public const PRIORITY_LIST = [
        'low' => 'Thấp',
        'medium' => 'Vừa',
        'high' => 'Cao',
    ];

    protected $fillable = [
        'title',
        'description',
        'due_date',
        'priority',
        'status',
    ];

    protected $casts = [
        'due_date' => 'date:Y-m-d',
    ];

    /**
     * * `priority` and `status` fall back to their column defaults when absent, so a title alone creates a task.
     * * Updates only validate the fields sent, which lets the list toggle `status` without resending the rest.
     *
     * @return array<string, array<int, string>>
     */
    public static function rules(mixed $ignoring = null): array
    {
        $required = $ignoring === null ? 'required' : 'sometimes';

        return [
            'title' => [$required, 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'due_date' => ['nullable', 'date_format:Y-m-d'],
            'priority' => ['sometimes', 'in:'.implode(',', array_keys(self::PRIORITY_LIST))],
            'status' => ['sometimes', 'in:'.implode(',', array_keys(self::STATUS_LIST))],
        ];
    }
}
