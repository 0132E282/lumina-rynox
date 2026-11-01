<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Role;

class File extends Model
{
    use HasFactory, SoftDeletes;

    protected static function booted(): void
    {
        static::creating(function (File $file) {
            $file->uuid ??= (string) Str::uuid();
            $file->full_path = $file->resolveFullPath();
        });

        static::updating(function (File $file) {
            if ($file->isDirty(['path', 'disk'])) {
                $file->full_path = $file->resolveFullPath();
            }
        });
    }

    protected $fillable = [
        'uuid',
        'parent_id',
        'type',
        'name',
        'original_name',
        'path',
        'full_path',
        'disk',
        'mime_type',
        'extension',
        'size',
        'alt',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'size' => 'integer',
        ];
    }

    protected $appends = ['url'];

    public function getUrlAttribute(): ?string
    {
        if ($this->isFolder() || ! $this->path) {
            return null;
        }

        return $this->full_path ?: $this->resolveFullPath();
    }

    public function resolveFullPath(): ?string
    {
        if ($this->isFolder() || ! $this->path) {
            return null;
        }

        return Storage::disk($this->disk)->url($this->path);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'created_by');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(File::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(File::class, 'parent_id');
    }

    public function roleGrants(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, 'role_files', 'folder_id', 'role_id')
            ->withPivot(['can_read', 'can_write', 'can_delete'])
            ->withTimestamps();
    }

    public function scopeFolders(Builder $query): Builder
    {
        return $query->where('type', 'folder');
    }

    public function scopeFiles(Builder $query): Builder
    {
        return $query->where('type', 'file');
    }

    /**
     * * Read access: system admins and owners see their items; a container with no role_files rows is open to everyone.
     * * Only explicitly configured containers restrict non-granted roles.
     */
    public function scopeVisibleTo(Builder $query, Admin $admin): Builder
    {
        if ($admin->system_admin) {
            return $query;
        }

        $roleIds = $admin->roles()->pluck('id');
        $rootReadable = self::containerGrantFor(null, $roleIds)['read'];

        return $query->where(function (Builder $query) use ($admin, $roleIds, $rootReadable) {
            $query->where('created_by', $admin->id);

            if ($rootReadable) {
                $query->orWhereNull('parent_id');
            }

            $query->orWhereIn('parent_id', function ($sub) {
                $sub->select('id')->from('files')
                    ->whereNotExists(function ($exists) {
                        $exists->selectRaw('1')->from('role_files')->whereColumn('role_files.folder_id', 'files.id');
                    });
            })
                ->orWhereIn('parent_id', function ($sub) use ($roleIds) {
                    $sub->select('folder_id')->from('role_files')
                        ->whereNotNull('folder_id')
                        ->whereIn('role_id', $roleIds)
                        ->where('can_read', true);
                });
        });
    }

    /**
     * * A container (`$folderId` null = root) without role_files rows gives full access to everyone.
     *
     * @param  Collection<int, int>  $roleIds
     */
    private static function containerGrantFor(?int $folderId, $roleIds): array
    {
        $base = fn () => DB::table('role_files')->where('folder_id', $folderId);

        if (! $base()->exists()) {
            return ['read' => true, 'write' => true, 'delete' => true];
        }

        $grant = $base()
            ->whereIn('role_id', $roleIds)
            ->selectRaw('max(can_read) as can_read, max(can_write) as can_write, max(can_delete) as can_delete')
            ->first();

        return [
            'read' => (bool) ($grant->can_read ?? false),
            'write' => (bool) ($grant->can_write ?? false),
            'delete' => (bool) ($grant->can_delete ?? false),
        ];
    }

    /** * Owners and system admins implicitly get full access. */
    public function permissionsFor(Admin $admin): array
    {
        if ($admin->system_admin || $this->created_by === $admin->id) {
            return ['read' => true, 'write' => true, 'delete' => true];
        }

        return self::containerGrantFor($this->id, $admin->roles()->pluck('id'));
    }

    /** * The root has no owner: only system admins get implicit full access. */
    public static function permissionsForRoot(Admin $admin): array
    {
        if ($admin->system_admin) {
            return ['read' => true, 'write' => true, 'delete' => true];
        }

        return self::containerGrantFor(null, $admin->roles()->pluck('id'));
    }

    public function isWritableBy(Admin $admin): bool
    {
        return $this->permissionsFor($admin)['write'];
    }

    public function isDeletableBy(Admin $admin): bool
    {
        return $this->permissionsFor($admin)['delete'];
    }

    public function canManagePermissions(Admin $admin): bool
    {
        return $admin->system_admin || $this->created_by === $admin->id;
    }

    /** * The root has no owner, so only system admins can manage its permissions. */
    public static function canManageRootPermissions(Admin $admin): bool
    {
        return (bool) $admin->system_admin;
    }

    public function isFolder(): bool
    {
        return $this->type === 'folder';
    }

    public function isImage(): bool
    {
        return str_starts_with((string) $this->mime_type, 'image/');
    }

    public function breadcrumbs(): array
    {
        $trail = [];
        $node = $this;

        while ($node) {
            array_unshift($trail, $node);
            $node = $node->parent;
        }

        return $trail;
    }
}
