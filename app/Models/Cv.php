<?php

declare(strict_types=1);

namespace App\Models;

use App\Concerns\QueryBuilder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

/**
 * A CV the user keeps for job hunting. `content` is the plain text of the CV; nothing here is sent to a job site.
 */
class Cv extends Model
{
    use QueryBuilder;

    // * Read by `AuthorizeResource`: the generic items API requires `cvs.{view,create,update,delete}`.
    public const PERMISSION_RESOURCE = 'cvs';

    // * Read by `ItemController::defaultSearchFields()`.
    public const SEARCH_FIELDS = ['name', 'position', 'note'];

    protected $fillable = [
        'name',
        'desired_position',
        'position',
        'expected_salary',
        'file_url',
        'file_path',
        'content',
        'latex',
        'note',
        'is_default',
    ];

    protected $casts = [
        'is_default' => 'boolean',
    ];

    protected static function booted(): void
    {
        // * The stored file goes with its CV.
        static::deleted(function (self $cv): void {
            if ($cv->file_path !== null) {
                Storage::delete($cv->file_path);
            }
        });

        // * One default CV: marking one clears the flag on the others.
        static::saved(function (self $cv): void {
            if ($cv->is_default) {
                static::query()->whereKeyNot($cv->id)->where('is_default', true)->update(['is_default' => false]);
            }
        });
    }

    /**
     * * Updates only validate the fields sent, so the list can change one field without resending the rest.
     *
     * @return array<string, array<int, string>>
     */
    public static function rules(mixed $ignoring = null): array
    {
        $required = $ignoring === null ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:255'],
            'desired_position' => ['nullable', 'string', 'max:255'],
            'position' => ['nullable', 'string', 'max:255'],
            'expected_salary' => ['nullable', 'string', 'max:100'],
            'file_url' => ['nullable', 'url:http,https', 'max:2048'],
            // * Only a path this app itself stored for an upload (see `CvController::upload`); never a free path.
            'file_path' => ['nullable', 'string', 'max:255', 'regex:#^cvs/[A-Za-z0-9-]+\.(pdf|docx|txt|md)$#'],
            'content' => ['nullable', 'string', 'max:20000'],
            'latex' => ['nullable', 'string', 'max:60000'],
            'note' => ['nullable', 'string', 'max:2000'],
            'is_default' => ['sometimes', 'boolean'],
        ];
    }
}
