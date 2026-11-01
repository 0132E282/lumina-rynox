<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Concerns\ClonesModelData;
use App\Http\Requests\Admin\AdminStoreRequest;
use App\Http\Requests\Admin\AdminUpdateRequest;
use App\Models\Admin;
use App\Notifications\AdminAccountCreatedNotification;
use App\Support\RuleSchemaConverter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\Permission\Models\Role;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AdminController extends Controller
{
    use ClonesModelData;

    private const SORT_COLUMNS = ['name', 'email', 'status', 'created_at'];

    public function index(Request $request): Response
    {
        $search = $request->string('search')->trim()->toString();
        $sort = $request->string('sort')->toString();
        $sort = in_array($sort, self::SORT_COLUMNS, true) ? $sort : 'created_at';
        $direction = $request->string('direction')->toString() === 'asc' ? 'asc' : 'desc';

        $admins = Admin::query()
            ->with('roles')
            ->when($search, function ($query) use ($search) {
                $query->where(function ($query) use ($search) {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%");
                });
            })
            ->orderBy($sort, $direction)
            ->paginate(10)
            ->withQueryString()
            ->through(fn (Admin $admin) => [
                ...$admin->toArray(),
                'role_names' => $admin->getRoleNames(),
            ]);

        return Inertia::render('admins/index', [
            'admins' => $admins,
            'search' => $search,
            'sort' => $sort,
            'direction' => $direction,
        ]);
    }

    public function create(): Response
    {
        return Inertia::render('admins/form', [
            'admin' => null,
            'roles' => Role::query()->orderBy('name')->get(['id', 'name']),
            'schema' => RuleSchemaConverter::forModel(Admin::class),
        ]);
    }

    public function edit(Admin $admin): Response
    {
        return Inertia::render('admins/form', [
            'admin' => [
                ...$admin->toArray(),
                'role_id' => $admin->roles()->first()?->id,
            ],
            'roles' => Role::query()->orderBy('name')->get(['id', 'name']),
            'schema' => RuleSchemaConverter::forModel(Admin::class),
        ]);
    }

    public function store(AdminStoreRequest $request): RedirectResponse|JsonResponse
    {
        $admin = new Admin($request->safe()->only(['name', 'email', 'phone', 'system_admin', 'status']));
        $admin->password = Hash::make($request->validated('password'));

        if ($request->hasFile('avatar')) {
            $admin->avatar = $request->file('avatar')->store('avatars', 'public');
        }

        $admin->save();
        $this->syncRole($admin, $request);

        $admin->notify(new AdminAccountCreatedNotification);

        if ($request->wantsJson()) {
            return response()->json(['data' => $admin->fresh(), 'message' => __('Đã tạo quản trị viên.')], 201);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã tạo quản trị viên.')]);

        return to_route('admins.index');
    }

    public function update(AdminUpdateRequest $request, Admin $admin): RedirectResponse|JsonResponse
    {
        $admin->fill($request->safe()->only(['name', 'email', 'phone', 'system_admin', 'status']));

        if ($request->filled('password')) {
            $admin->password = Hash::make($request->validated('password'));
        }

        if ($request->hasFile('avatar')) {
            $disk = Storage::disk('public');

            if ($admin->avatar) {
                $disk->delete($admin->avatar);
            }

            $admin->avatar = $request->file('avatar')->store('avatars', 'public');
        }

        $admin->save();
        $this->syncRole($admin, $request);

        if ($request->wantsJson()) {
            return response()->json(['data' => $admin->fresh(), 'message' => __('Đã cập nhật quản trị viên.')]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã cập nhật quản trị viên.')]);

        return to_route('admins.index');
    }

    /** * System admins implicitly have every permission (no role); others get exactly the selected role. */
    private function syncRole(Admin $admin, Request $request): void
    {
        if ($admin->system_admin) {
            $admin->syncRoles([]);

            return;
        }

        $roleId = $request->input('role_id');
        $role = $roleId ? Role::query()->find($roleId) : null;

        $admin->syncRoles($role ? [$role] : []);
    }

    public function destroy(Admin $admin): RedirectResponse
    {
        $admin->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã xóa quản trị viên.')]);

        return to_route('admins.index');
    }

    public function trash(Request $request): Response
    {
        $search = $request->string('search')->trim()->toString();

        $admins = Admin::onlyTrashed()
            ->when($search, function ($query) use ($search) {
                $query->where(function ($query) use ($search) {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%");
                });
            })
            ->orderBy('deleted_at', 'desc')
            ->paginate(10)
            ->withQueryString();

        return Inertia::render('admins/trash', [
            'admins' => $admins,
            'search' => $search,
        ]);
    }

    public function restore(int $admin): RedirectResponse
    {
        $trashed = Admin::onlyTrashed()->findOrFail($admin);

        $copy = $this->cloneModelData($trashed);
        $copy->email = 'restored-'.uniqid().'-'.$trashed->email;
        $copy->save();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã khôi phục quản trị viên thành bản sao mới.')]);

        return to_route('admins.index');
    }

    public function forceDelete(int $admin): RedirectResponse
    {
        Admin::onlyTrashed()->findOrFail($admin)->forceDelete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã xóa vĩnh viễn quản trị viên.')]);

        return to_route('admins.trash');
    }

    public function bulkDestroy(Request $request): RedirectResponse
    {
        $ids = (array) $request->input('ids', []);

        Admin::query()->whereIn('id', $ids)->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã xóa các quản trị viên đã chọn.')]);

        return to_route('admins.index');
    }

    public function bulkDuplicate(Request $request): RedirectResponse
    {
        $ids = (array) $request->input('ids', []);

        Admin::query()->whereIn('id', $ids)->get()->each(function (Admin $admin) {
            $copy = $admin->replicate(['email', 'password']);
            $copy->name = "{$admin->name} (bản sao)";
            $copy->email = 'copy-'.uniqid().'-'.$admin->email;
            $copy->password = $admin->password;
            $copy->save();
        });

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã nhân bản các quản trị viên đã chọn.')]);

        return to_route('admins.index');
    }

    public function export(Request $request): StreamedResponse
    {
        $filename = 'admins-'.now()->format('Y-m-d-His').'.csv';

        activity()
            ->causedBy($request->user())
            ->event('export')
            ->log("Đã xuất danh sách quản trị viên ({$filename}).");

        return response()->streamDownload(function () {
            $handle = fopen('php://output', 'w');

            fputcsv($handle, ['ID', 'Tên', 'Email', 'Điện thoại', 'Quản trị hệ thống', 'Trạng thái', 'Ngày tạo']);

            Admin::query()->orderBy('id')->chunk(200, function ($admins) use ($handle) {
                foreach ($admins as $admin) {
                    fputcsv($handle, [
                        $admin->id,
                        $admin->name,
                        $admin->email,
                        $admin->phone,
                        $admin->system_admin ? 'Có' : 'Không',
                        $admin->status,
                        $admin->created_at?->toDateTimeString(),
                    ]);
                }
            });

            fclose($handle);
        }, $filename, ['Content-Type' => 'text/csv']);
    }

    public function import(Request $request): RedirectResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'mimes:csv,txt'],
        ]);

        $handle = fopen($request->file('file')->getRealPath(), 'r');
        $imported = 0;

        fgetcsv($handle);

        while (($row = fgetcsv($handle)) !== false) {
            $name = $row[0] ?? null;
            $email = $row[1] ?? null;

            if (! $name || ! $email || Admin::query()->where('email', $email)->exists()) {
                continue;
            }

            Admin::query()->create([
                'name' => $name,
                'email' => $email,
                'phone' => $row[2] ?? null,
                'password' => Hash::make(str()->random(16)),
                'system_admin' => false,
                'status' => 'active',
            ]);

            $imported++;
        }

        fclose($handle);

        activity()
            ->causedBy($request->user())
            ->event('import')
            ->log("Đã nhập {$imported} quản trị viên từ file CSV.");

        Inertia::flash('toast', ['type' => 'success', 'message' => __(':count quản trị viên đã được nhập.', ['count' => $imported])]);

        return to_route('admins.index');
    }
}
