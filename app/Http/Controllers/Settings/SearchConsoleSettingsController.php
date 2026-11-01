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

class SearchConsoleSettingsController extends Controller
{
    use PersistsSettings;

    public function edit(): Response
    {
        $values = Setting::many(['google_search_console.credentials_path', 'google_search_console.site_url']);

        return Inertia::render('settings/search-console', [
            'setting' => [
                'site_url' => $values['google_search_console.site_url'] ?? null,
                'has_credentials' => filled($values['google_search_console.credentials_path'] ?? null),
            ],
        ]);
    }

    public function update(Request $request): RedirectResponse|JsonResponse
    {
        $validated = $request->validate([
            'site_url' => ['nullable', 'url', 'max:255'],
            'credentials' => ['nullable', 'file', 'mimes:json', 'max:512'],
        ]);

        $disk = Storage::disk('local');
        $values = [];

        if (array_key_exists('site_url', $validated)) {
            $values['google_search_console.site_url'] = $validated['site_url'];
        }

        if ($request->hasFile('credentials')) {
            if (! $disk->exists('google')) {
                $disk->makeDirectory('google');
            }

            $old = Setting::get('google_search_console.credentials_path');

            if ($old) {
                $disk->delete($old);
            }

            $values['google_search_console.credentials_path'] = $request->file('credentials')->store('google', 'local');
        }

        $this->persistSettings($request, $values, 'Đã cập nhật cấu hình Google Search Console.');

        if ($request->wantsJson()) {
            return response()->json(['message' => __('Đã lưu cấu hình Google Search Console.')]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã lưu cấu hình Google Search Console.')]);

        return to_route('search-console.edit');
    }
}
