<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\Admin;
use Illuminate\Contracts\Auth\Authenticatable;

/** * `{resource}.{ability}` permission check; system admins hold every permission implicitly (no role). */
final class ResourcePermission
{
    public static function allows(?Authenticatable $user, string $resource, string $ability): bool
    {
        if (! $user instanceof Admin) {
            return false;
        }

        return $user->system_admin || $user->can("{$resource}.{$ability}");
    }
}
