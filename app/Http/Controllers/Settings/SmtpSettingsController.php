<?php

declare(strict_types=1);

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Settings\Concerns\PersistsSettings;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class SmtpSettingsController extends Controller
{
    use PersistsSettings;

    // * Form field name => storage key under "mail.".
    private const FIELD_KEYS = [
        'mail_host' => 'mail.host',
        'mail_port' => 'mail.port',
        'mail_username' => 'mail.username',
        'mail_password' => 'mail.password',
        'mail_encryption' => 'mail.encryption',
        'mail_from_address' => 'mail.from_address',
        'mail_from_name' => 'mail.from_name',
    ];

    public function edit(): Response
    {
        $values = Setting::many(array_values(self::FIELD_KEYS));

        return Inertia::render('settings/smtp', [
            'setting' => [
                'mail_host' => $values['mail.host'] ?? null,
                'mail_port' => $values['mail.port'] ?? null,
                'mail_username' => $values['mail.username'] ?? null,
                'mail_encryption' => $values['mail.encryption'] ?? null,
                'mail_from_address' => $values['mail.from_address'] ?? null,
                'mail_from_name' => $values['mail.from_name'] ?? null,
                'has_password' => filled($values['mail.password'] ?? null),
            ],
        ]);
    }

    public function update(Request $request): RedirectResponse|JsonResponse
    {
        $validated = $request->validate([
            'mail_host' => ['nullable', 'string', 'max:255'],
            'mail_port' => ['nullable', 'integer', 'between:1,65535'],
            'mail_username' => ['nullable', 'string', 'max:255'],
            'mail_password' => ['nullable', 'string', 'max:255'],
            'mail_encryption' => ['nullable', 'in:tls,ssl'],
            'mail_from_address' => ['nullable', 'email', 'max:255'],
            'mail_from_name' => ['nullable', 'string', 'max:255'],
        ]);

        if (blank($validated['mail_password'] ?? null)) {
            unset($validated['mail_password']);
        }

        $values = [];

        foreach ($validated as $field => $value) {
            $values[self::FIELD_KEYS[$field]] = $value;
        }

        $this->persistSettings($request, $values, 'Đã cập nhật cấu hình SMTP.');

        if ($request->wantsJson()) {
            return response()->json(['message' => __('Đã lưu cấu hình SMTP.')]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã lưu cấu hình SMTP.')]);

        return to_route('smtp.edit');
    }
}
