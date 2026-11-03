<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\AiAccount;
use App\Models\Integration;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Ai\CliLlmClient;
use App\Services\Ai\CliLogin;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
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
            'model' => null,
            'priority' => 100,
            ...$this->attributes($validated),
            'name' => $this->nameFor($validated),
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

        // * A blank or missing name keeps the saved one.
        if (filled($validated['name'] ?? null)) {
            $account->name = $validated['name'];
        }

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

    /**
     * Settings stored on the `ai` integration: the conversation that receives the daily report (blank turns the report off) and which account answers each purpose first.
     * Only the keys present in the request change, so saving one never wipes the other.
     */
    public function settings(Request $request): RedirectResponse
    {
        // * Every purpose arrives as an ordered list of {account_id, model}; "automatic" (null or empty) is dropped, and the older single-value shapes read as a one-entry list.
        if (is_array($request->input('purpose_accounts'))) {
            $request->merge(['purpose_accounts' => array_filter(
                array_map(fn (mixed $value): array => AiAssistant::choiceList($value), $request->input('purpose_accounts')),
                fn (array $list): bool => $list !== [],
            )]);
        }

        $validated = $request->validate([
            'report_conversation_id' => ['nullable', 'uuid', 'exists:conversations,id'],
            'purpose_accounts' => ['nullable', 'array'],
            'purpose_accounts.*' => ['array', 'max:'.AiAssistant::MAX_PURPOSE_CHOICES],
            // * Only an account that is connected can be chosen; the model follows the same safe-code rule as the CLI client.
            'purpose_accounts.*.*.account_id' => ['required', 'integer', Rule::exists('ai_accounts', 'id')->where('status', 'connected')],
            'purpose_accounts.*.*.model' => ['nullable', 'string', 'max:100', 'regex:'.CliLlmClient::MODEL_PATTERN],
        ]);

        $purposeAccounts = [];

        foreach ($validated['purpose_accounts'] ?? [] as $purpose => $list) {
            if (! array_key_exists($purpose, AiAccount::PURPOSES)) {
                throw ValidationException::withMessages(['purpose_accounts' => 'Mục đích không hợp lệ.']);
            }

            $entries = array_map(fn (array $entry): array => ['account_id' => (int) $entry['account_id'], 'model' => filled($entry['model'] ?? null) ? (string) $entry['model'] : null], array_values($list));

            if (count(array_unique(array_map(fn (array $entry): string => $entry['account_id'].'|'.$entry['model'], $entries))) !== count($entries)) {
                throw ValidationException::withMessages(["purpose_accounts.{$purpose}" => 'Không chọn trùng một AI và model trong cùng mục đích.']);
            }

            $purposeAccounts[$purpose] = $entries;
        }

        $integration = Integration::query()->firstOrNew(['provider' => AiAssistant::PROVIDER]);
        $settings = $integration->settings ?? [];

        if ($request->has('report_conversation_id')) {
            $settings['fields']['report_conversation_id'] = isset($validated['report_conversation_id']) ? (string) $validated['report_conversation_id'] : null;
        }

        if ($request->has('purpose_accounts')) {
            $settings['fields'][AiAssistant::SETTING_PURPOSE_ACCOUNTS] = $purposeAccounts;
        }

        $integration->settings = $settings;
        $integration->status ??= Integration::STATUS_CONNECTED;
        $integration->save();

        return $this->back('Đã lưu cấu hình AI.');
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, ?AiAccount $account): array
    {
        return $request->validate([
            // * The name is optional: a new account gets a generated one, an old client may still send its own.
            'name' => ['nullable', 'string', 'max:100'],
            'vendor' => ['required', Rule::in(array_keys(AiAccount::VENDORS))],
            'auth_type' => ['required', Rule::in(array_keys(AiAccount::AUTH_TYPES))],
            // * A CLI session account may leave the token blank: the CLI then uses the login of this machine (`claude login`).
            'token' => [$account === null ? Rule::requiredIf($request->input('auth_type') !== AiAccount::AUTH_SESSION) : 'nullable', 'nullable', 'string', 'max:2000'],
            'model' => ['nullable', 'string', 'max:100', 'regex:/^[A-Za-z0-9][A-Za-z0-9._:-]*$/'],
            'purposes' => ['nullable', 'array'],
            'purposes.*' => ['string', 'distinct', Rule::in(array_keys(AiAccount::PURPOSES))],
            'priority' => ['nullable', 'integer', 'min:0', 'max:1000'],
        ]);
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function attributes(array $validated): array
    {
        $attributes = [
            'vendor' => $validated['vendor'],
            'auth_type' => $validated['auth_type'],
        ];

        // * The dialog no longer sends the model or the priority: a new account gets the provider default and 100 (see `store`), an edit leaves the saved values alone.
        if (array_key_exists('model', $validated)) {
            $attributes['model'] = filled($validated['model']) ? $validated['model'] : null;
        }

        if (filled($validated['priority'] ?? null)) {
            $attributes['priority'] = (int) $validated['priority'];
        }

        // * The dialog no longer sends purposes: a new account then serves all of them (null) and an edit leaves the saved ones alone.
        if (array_key_exists('purposes', $validated)) {
            $purposes = array_values($validated['purposes'] ?? []);
            // * Every purpose ticked (or none) is stored as null = "all", so a purpose added later is covered.
            $attributes['purposes'] = $purposes === [] || count($purposes) === count(AiAccount::PURPOSES) ? null : $purposes;
        }

        return $attributes;
    }

    /**
     * The name of a new account: the one sent, else the provider and token type ("OpenAI / Codex CLI" for a session token, "Claude · API token" for an API one), with a numeric suffix when taken.
     * ! Built from the form's own choices only: no credential file, token or config is read to find an identity.
     *
     * @param  array<string, mixed>  $validated
     */
    private function nameFor(array $validated): string
    {
        if (filled($validated['name'] ?? null)) {
            return $validated['name'];
        }

        $vendor = Str::before(AiAccount::VENDORS[$validated['vendor']], ' (');
        $base = $validated['auth_type'] === AiAccount::AUTH_SESSION ? "{$vendor} CLI" : "{$vendor} · ".Str::before(AiAccount::AUTH_TYPES[$validated['auth_type']], ' (');
        $name = $base;

        for ($number = 2; AiAccount::query()->where('name', $name)->exists(); $number++) {
            $name = "{$base} {$number}";
        }

        return $name;
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
