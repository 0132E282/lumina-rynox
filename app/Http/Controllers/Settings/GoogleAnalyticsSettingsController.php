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

class GoogleAnalyticsSettingsController extends Controller
{
    use PersistsSettings;

    public function edit(): Response
    {
        $values = Setting::many(['google_analytics.credentials_path', 'google_analytics.property_id']);

        return Inertia::render('settings/google-analytics', [
            'setting' => [
                'property_id' => $values['google_analytics.property_id'] ?? config('services.google_analytics.property_id'),
                'has_credentials' => filled($values['google_analytics.credentials_path'] ?? null),
            ],
        ]);
    }

    public function update(Request $request): RedirectResponse|JsonResponse
    {
        $validated = $request->validate([
            'property_id' => ['nullable', 'string', 'regex:/^\d+$/', 'max:32'],
            'credentials' => ['nullable', 'file', 'mimes:json', 'max:512'],
        ]);

        $values = [
            'google_analytics.property_id' => $validated['property_id'] ?? null,
        ];

        if ($request->hasFile('credentials')) {
            $disk = Storage::disk('local');

            if (! $disk->exists('google')) {
                $disk->makeDirectory('google');
            }

            $old = Setting::get('google_analytics.credentials_path');

            if ($old) {
                $disk->delete($old);
            }

            $values['google_analytics.credentials_path'] = $request->file('credentials')->store('google', 'local');
        }

        $this->persistSettings($request, $values, 'Đã cập nhật cấu hình Google Analytics.');

        if ($request->wantsJson()) {
            return response()->json(['message' => __('Đã lưu cấu hình Google Analytics.')]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã lưu cấu hình Google Analytics.')]);

        return to_route('google-analytics.edit');
    }
}
