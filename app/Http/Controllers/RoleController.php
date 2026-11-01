<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;

class RoleController extends Controller
{
    public function index(): Response
    {
        $roles = Role::query()
            ->withCount('permissions')
            ->orderBy('name')
            ->get()
            ->map(fn (Role $role) => [
                'id' => $role->id,
                'name' => $role->name,
                'permissions_count' => $role->permissions_count,
                'created_at' => $role->created_at?->format('Y-m-d H:i'),
            ]);

        $fileTree = File::folders()
            ->get(['id', 'parent_id', 'name'])
            ->map(fn (File $folder) => [
                'id' => $folder->id,
                'parent_id' => $folder->parent_id,
                'name' => $folder->name,
            ]);

        return Inertia::render('roles/index', [
            'roles' => $roles,
            'fileTree' => $fileTree,
        ]);
    }

    public function store(Request $request): RedirectResponse|JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:roles,name'],
        ]);

        $role = Role::create(['name' => $validated['name']]);

        activity()
            ->performedOn($role)
            ->causedBy($request->user())
            ->event('created')
            ->log("Đã tạo vai trò \"{$role->name}\".");

        if ($request->wantsJson()) {
            return response()->json(['data' => $role], 201);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã tạo vai trò.')]);

        return to_route('roles.index');
    }

    /** * Every permission grouped by its resource prefix (`admins.view` -> group `admins`), for the permission matrix UI. */
    public function permissionsCatalog(): JsonResponse
    {
        $grouped = Permission::query()
            ->orderBy('name')
            ->get()
            ->groupBy(fn (Permission $permission) => Str::before($permission->name, '.'))
            ->map(fn ($permissions, string $resource) => [
                'resource' => $resource,
                'permissions' => $permissions->map(fn (Permission $permission) => [
                    'id' => $permission->id,
                    'name' => $permission->name,
                    'action' => Str::after($permission->name, '.'),
                ])->values(),
            ])
            ->values();

        return response()->json(['data' => $grouped]);
    }

    public function permissionsData(Role $role): JsonResponse
    {
        return response()->json([
            'data' => $role->permissions()->pluck('name'),
        ]);
    }

    public function updatePermissions(Request $request, Role $role): RedirectResponse|JsonResponse
    {
        $validated = $request->validate([
            'permissions' => ['array'],
            'permissions.*' => ['string', 'exists:permissions,name'],
        ]);

        $role->syncPermissions($validated['permissions'] ?? []);

        activity()
            ->performedOn($role)
            ->causedBy($request->user())
            ->event('updated')
            ->log("Đã cập nhật quyền hạn của vai trò \"{$role->name}\".");

        if ($request->wantsJson()) {
            return response()->json(['success' => true]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã cập nhật quyền hạn.')]);

        return to_route('roles.index');
    }

    public function update(Request $request, Role $role): RedirectResponse|JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:roles,name,'.$role->id],
        ]);

        $role->update(['name' => $validated['name']]);

        activity()
            ->performedOn($role)
            ->causedBy($request->user())
            ->event('updated')
            ->log("Đã cập nhật vai trò \"{$role->name}\".");

        if ($request->wantsJson()) {
            return response()->json(['data' => $role]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã cập nhật vai trò.')]);

        return to_route('roles.index');
    }

    public function destroy(Request $request, Role $role): RedirectResponse
    {
        $roleName = $role->name;
        $role->delete();

        activity()
            ->causedBy($request->user())
            ->event('deleted')
            ->log("Đã xóa vai trò \"{$roleName}\".");

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã xóa vai trò.')]);

        return to_route('roles.index');
    }
}
