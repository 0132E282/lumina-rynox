<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\AiAccount;
use App\Models\Integration;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Ai\CliLogin;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

/**
 * * Management of the AI accounts on the Integrations page (`integrations.update`, route middleware).
 * ! The token is write-only: it is stored encrypted, never returned (only a 4-character mask is) and never logged. A blank token on edit keeps the stored one.
 */
class AiAccountController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        $validated = $this->validated($request, null);
        $this->ensureSupported($validated['vendor'], $validated['auth_type']);

        AiAccount::query()->create([
            ...$this->attributes($validated),
            'credentials' => filled($validated['token'] ?? null) ? ['token' => $validated['token']] : null,
            'status' => Integration::STATUS_CONNECTED,
        ]);

        return $this->back('Đã thêm tài khoản AI.');
    }

    public function update(Request $request, AiAccount $account): RedirectResponse
    {
        $validated = $this->validated($request, $account);
        $this->ensureSupported($validated['vendor'], $validated['auth_type']);

        $account->fill($this->attributes($validated));

        if (filled($validated['token'] ?? null)) {
            $account->credentials = ['token' => $validated['token']];
        }

        $account->save();

        return $this->back('Đã lưu tài khoản AI.');
    }

    public function toggle(AiAccount $account): RedirectResponse
    {
        $account->forceFill(['enabled' => ! $account->enabled])->save();

        return $this->back($account->enabled ? 'Đã bật tài khoản AI.' : 'Đã tắt tài khoản AI.');
    }

    public function destroy(AiAccount $account): RedirectResponse
    {
        $account->delete();

        return $this->back('Đã xoá tài khoản AI.');
    }

    /** * Opens the CLI's own browser login on this machine; the page then polls `cliStatus`. */
    public function cliLogin(Request $request, CliLogin $login): JsonResponse
    {
        $vendor = $request->validate(['vendor' => ['required', Rule::in(CliLogin::VENDORS)]])['vendor'];

        return response()->json(['started' => $login->start($vendor)]);
    }

    public function cliStatus(Request $request, CliLogin $login): JsonResponse
    {
        $vendor = $request->validate(['vendor' => ['required', Rule::in(CliLogin::VENDORS)]])['vendor'];

        return response()->json(['logged_in' => $login->loggedIn($vendor)]);
    }

    /** * One short real call through this account only; the outcome is stored on it. Only fixed texts are shown. */
    public function test(AiAccount $account, AiAssistant $assistant): RedirectResponse
    {
        try {
            $assistant->completeWith($account, 'Trả lời đúng một từ.', 'Trả lời: OK');
        } catch (AiException $exception) {
            return $this->back($exception->getMessage(), 'error');
        }

        return $this->back('Kết nối thành công.');
    }

    /** * The conversation that receives the daily report; blank turns the report off. */
    public function settings(Request $request): RedirectResponse
    {
        $validated = $request->validate(['report_conversation_id' => ['nullable', 'uuid', 'exists:conversations,id']]);

        $integration = Integration::query()->firstOrNew(['provider' => AiAssistant::PROVIDER]);
        $settings = $integration->settings ?? [];
        $settings['fields']['report_conversation_id'] = isset($validated['report_conversation_id']) ? (string) $validated['report_conversation_id'] : null;
        $integration->settings = $settings;
        $integration->status ??= Integration::STATUS_CONNECTED;
        $integration->save();

        return $this->back('Đã lưu cấu hình báo cáo.');
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, ?AiAccount $account): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'vendor' => ['required', Rule::in(array_keys(AiAccount::VENDORS))],
            'auth_type' => ['required', Rule::in(array_keys(AiAccount::AUTH_TYPES))],
            // * A CLI session account may leave the token blank: the CLI then uses the login of this machine (`claude login`).
            'token' => [$account === null ? Rule::requiredIf($request->input('auth_type') !== AiAccount::AUTH_SESSION) : 'nullable', 'nullable', 'string', 'max:2000'],
            'model' => ['nullable', 'string', 'max:100', 'regex:/^[A-Za-z0-9][A-Za-z0-9._:-]*$/'],
            'purposes' => ['nullable', 'array'],
            'purposes.*' => ['string', 'distinct', Rule::in(array_keys(AiAccount::PURPOSES))],
            'priority' => ['required', 'integer', 'min:0', 'max:1000'],
        ]);
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function attributes(array $validated): array
    {
        $purposes = array_values($validated['purposes'] ?? []);

        return [
            'name' => $validated['name'],
            'vendor' => $validated['vendor'],
            'auth_type' => $validated['auth_type'],
            'model' => filled($validated['model'] ?? null) ? $validated['model'] : null,
            // * Every purpose ticked (or none) is stored as null = "all", so a purpose added later is covered.
            'purposes' => $purposes === [] || count($purposes) === count(AiAccount::PURPOSES) ? null : $purposes,
            'priority' => (int) $validated['priority'],
        ];
    }

    // * DeepSeek has no CLI, so a session token for it could never be used.
    private function ensureSupported(string $vendor, string $authType): void
    {
        if ($vendor === 'deepseek' && $authType === AiAccount::AUTH_SESSION) {
            throw ValidationException::withMessages(['auth_type' => AiException::CLI_UNSUPPORTED]);
        }
    }

    private function back(string $message, string $type = 'success'): RedirectResponse
    {
        Inertia::flash('toast', ['type' => $type, 'message' => $message]);

        return back();
    }
}
