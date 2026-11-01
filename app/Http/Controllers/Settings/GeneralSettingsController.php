<?php

declare(strict_types=1);

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Settings\Concerns\PersistsSettings;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;
use Inertia\Response;

class GeneralSettingsController extends Controller
{
    use PersistsSettings;

    public function edit(): Response
    {
        $values = Setting::many(['system.site_name', 'system.logo', 'system.favicon']);
        $disk = Storage::disk('public');

        return Inertia::render('settings/general', [
            'setting' => [
                'site_name' => $values['system.site_name'] ?? null,
                'logo_url' => isset($values['system.logo']) ? $disk->url($values['system.logo']) : null,
                'favicon_url' => isset($values['system.favicon']) ? $disk->url($values['system.favicon']) : null,
            ],
        ]);
    }

    public function update(Request $request): RedirectResponse|JsonResponse
    {
        $validated = $request->validate([
            'site_name' => ['nullable', 'string', 'max:255'],
            'logo' => ['nullable', 'file', 'image', 'max:2048'],
            'favicon' => ['nullable', 'file', 'image', 'max:512'],
        ]);

        $disk = Storage::disk('public');

        if (! $disk->exists('branding')) {
            $disk->makeDirectory('branding');
        }

        $values = [];

        if (array_key_exists('site_name', $validated)) {
            $values['system.site_name'] = $validated['site_name'];
        }

        foreach (['logo', 'favicon'] as $field) {
            if (! $request->hasFile($field)) {
                continue;
            }

            $key = "system.{$field}";
            $old = Setting::get($key);

            if ($old) {
                $disk->delete($old);
            }

            $values[$key] = $request->file($field)->store('branding', 'public');
        }

        $this->persistSettings($request, $values, 'Đã cập nhật cấu hình hệ thống.');

        if ($request->wantsJson()) {
            return response()->json(['message' => __('Đã lưu cấu hình hệ thống.')]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã lưu cấu hình hệ thống.')]);

        return to_route('general.edit');
    }
}
