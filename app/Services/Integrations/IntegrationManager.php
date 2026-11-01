<?php

declare(strict_types=1);

namespace App\Services\Integrations;

use App\Models\AiAccount;
use App\Models\Integration;
use App\Models\Mailbox;
use App\Models\MessengerAccount;
use App\Models\ZaloAccount;
use App\Services\Chat\Messenger\MessengerChannel;
use App\Services\Chat\Zalo\ZaloChannel;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Date;

/**
 * @phpstan-type Definition array{name: string, letter: string, color: string, category: string, active: bool, description: string, save_label: string, unofficial?: bool, manage_url?: string, login?: string, page?: string, test?: string, steps: list<string>, fields: list<array<string, mixed>>, permissions: list<array<string, mixed>>}
 *
 * Entry point to the provider catalog in `config/integrations.php`: definitions, provider instances and client-safe page data. */
class IntegrationManager
{
    /** Label for a stored `connected` status on a provider without runtime code: the config is saved, nothing is connected. */
    public const SAVED_CONFIG_LABEL = 'Đã lưu cấu hình';

    /** @return array<string, Definition> */
    public function definitions(): array
    {
        return config('integrations.providers', []);
    }

    /** @return ?Definition */
    public function definition(string $key): ?array
    {
        return $this->definitions()[$key] ?? null;
    }

    public function provider(string $key): ?IntegrationProvider
    {
        $definition = $this->definition($key);

        return $definition === null ? null : new ConfiguredIntegrationProvider($key, $definition);
    }

    /** Presentation only: the stored status is never changed. */
    private function statusLabel(string $status, bool $active, string $key = ''): string
    {
        // * Messenger has a full runtime and its status comes from the signed-in accounts, so it never reads as "saved config" while `active` is still off.
        return $status === Integration::STATUS_CONNECTED && ! $active && $key !== MessengerChannel::PROVIDER
            ? self::SAVED_CONFIG_LABEL
            : Integration::STATUS_LABELS[$status];
    }

    /**
     * Cards for the overview page grouped by `categories`, from one status query. Only name, logo, description and status: never credentials.
     *
     * @return list<array{key: string, title: string, providers: list<array<string, mixed>>}>
     */
    public function overview(): array
    {
        $statuses = $this->statuses();
        $mailboxStatus = null;
        $groups = [];

        foreach ((array) config('integrations.categories', []) as $category => $title) {
            $providers = [];

            foreach ($this->definitions() as $key => $definition) {
                if ($definition['category'] !== $category) {
                    continue;
                }

                // * A provider with its own management screen reports the state of that module's records (one extra query, only once).
                if (isset($definition['manage_url'])) {
                    $status = $mailboxStatus ??= $this->mailboxStatus();
                } elseif ($key === 'ai') {
                    // * The AI provider is its accounts: any error wins, then any enabled connected account.
                    $status = $this->aiStatus();
                } else {
                    $status = $statuses[$key] ?? Integration::STATUS_DISCONNECTED;
                }

                $active = (bool) ($definition['active'] ?? false);
                $providers[] = [
                    'key' => $key,
                    'name' => $definition['name'],
                    'letter' => $definition['letter'],
                    'color' => $definition['color'],
                    'description' => $definition['description'],
                    'active' => $active,
                    'status' => $status,
                    'status_label' => $this->statusLabel($status, $active, $key),
                    'accounts' => $this->accountCounts($key),
                ];
            }

            if ($providers !== []) {
                $groups[] = ['key' => $category, 'title' => $title, 'providers' => $providers];
            }
        }

        return $groups;
    }

    /**
     * Connected / total accounts of the multi-account channels; null for every other provider. Before the table exists it reads as none.
     *
     * @return array{connected: int, total: int}|null
     */
    private function accountCounts(string $provider): ?array
    {
        $model = match ($provider) {
            'zalo' => ZaloAccount::class,
            'messenger' => MessengerAccount::class,
            default => null,
        };

        if ($model === null) {
            return null;
        }

        try {
            return [
                'connected' => $model::query()->where('status', Integration::STATUS_CONNECTED)->count(),
                'total' => $model::query()->count(),
            ];
        } catch (QueryException) {
            return ['connected' => 0, 'total' => 0];
        }
    }

    /** Summary of the AI accounts: an error wins, then a connected enabled account. Before the table exists it reads as disconnected. */
    private function aiStatus(): string
    {
        try {
            $accounts = AiAccount::query()->get(['status', 'enabled']);
        } catch (QueryException) {
            return Integration::STATUS_DISCONNECTED;
        }

        return match (true) {
            $accounts->where('enabled', true)->where('status', Integration::STATUS_ERROR)->isNotEmpty() => Integration::STATUS_ERROR,
            $accounts->where('enabled', true)->where('status', Integration::STATUS_CONNECTED)->isNotEmpty() => Integration::STATUS_CONNECTED,
            default => Integration::STATUS_DISCONNECTED,
        };
    }

    /**
     * AI accounts for the integration page, ordered like they are tried. The token never leaves: only its 4-character mask.
     *
     * @return list<array<string, mixed>>
     */
    private function aiAccounts(): array
    {
        try {
            $accounts = AiAccount::query()->orderBy('priority')->orderBy('id')->get();
        } catch (QueryException) {
            return [];
        }

        return $accounts->map(fn (AiAccount $account): array => [
            'id' => $account->id,
            'name' => $account->name,
            'vendor' => $account->vendor,
            'auth_type' => $account->auth_type,
            'model' => $account->model,
            'enabled' => $account->enabled,
            'status' => $account->status,
            'last_error' => $account->last_error,
            'last_checked_at' => $account->last_checked_at?->toIso8601String(),
            'purposes' => $account->purposes ?? array_keys(AiAccount::PURPOSES),
            'priority' => $account->priority,
            'token_mask' => $account->maskedToken(),
        ])->values()->all();
    }

    /** Summary of every mailbox: any error wins, then connected, otherwise disconnected. Before the table exists it reads as disconnected. */
    private function mailboxStatus(): string
    {
        try {
            $statuses = Mailbox::query()->distinct()->pluck('status')->all();
        } catch (QueryException) {
            return Integration::STATUS_DISCONNECTED;
        }

        return match (true) {
            in_array(Mailbox::STATUS_ERROR, $statuses, true) => Integration::STATUS_ERROR,
            in_array(Mailbox::STATUS_CONNECTED, $statuses, true) => Integration::STATUS_CONNECTED,
            default => Integration::STATUS_DISCONNECTED,
        };
    }

    /**
     * Provider key => status, in one query. Before the table exists (migration not run yet) every provider reads as disconnected.
     *
     * @return array<string, string>
     */
    public function statuses(): array
    {
        try {
            return Integration::query()->pluck('status', 'provider')->all();
        } catch (QueryException) {
            return [];
        }
    }

    /**
     * Everything the page needs and nothing secret: secrets appear only as `configured` plus a 4-character mask.
     *
     * @param  Definition  $definition
     * @return array<string, mixed>
     */
    public function present(string $key, array $definition, ?Integration $integration): array
    {
        $values = $integration?->settings['fields'] ?? [];
        $masks = $integration?->maskedSecrets() ?? [];
        $checked = $integration === null
            ? null
            : ($integration->settings['permissions'] ?? []);
        $status = $integration->status ?? Integration::STATUS_DISCONNECTED;
        $active = (bool) ($definition['active'] ?? false);
        $hasAccounts = in_array($key, [MessengerChannel::PROVIDER, ZaloChannel::PROVIDER], true);
        $accounts = match ($key) {
            MessengerChannel::PROVIDER => $this->messengerAccounts($integration),
            ZaloChannel::PROVIDER => $this->zaloAccounts($integration),
            default => [],
        };

        $fields = collect($definition['fields'])->map(function (array $field) use ($values, $masks): array {
            $options = [];

            foreach ((array) ($field['options'] ?? []) as $value => $label) {
                $options[] = ['value' => (string) $value, 'label' => $label];
            }
            $isSecret = $field['type'] === 'secret';

            return [
                'key' => $field['key'],
                'label' => $field['label'],
                'type' => $field['type'],
                'required' => $field['required'] ?? false,
                'hint' => $field['hint'] ?? null,
                'placeholder' => $field['placeholder'] ?? null,
                'unofficial' => $field['unofficial'] ?? false,
                'options' => $options,
                'value' => $isSecret ? null : ($values[$field['key']] ?? ($options[0]['value'] ?? '')),
                'mask' => $isSecret ? ($masks[$field['key']] ?? null) : null,
            ];
        })->all();

        $permissions = collect($definition['permissions'])->map(fn (array $permission): array => [
            'key' => $permission['key'],
            'label' => $permission['label'],
            'description' => $permission['description'],
            'unofficial' => $permission['unofficial'] ?? false,
            'checked' => $checked === null ? $permission['default'] : in_array($permission['key'], $checked, true),
        ])->all();

        return [
            'key' => $key,
            'name' => $definition['name'],
            'letter' => $definition['letter'],
            'color' => $definition['color'],
            'description' => $definition['description'],
            'save_label' => $definition['save_label'],
            'unofficial' => $definition['unofficial'] ?? false,
            'unofficial_warning' => config('integrations.unofficial_warning'),
            'risk_acknowledged' => (bool) ($integration?->settings['risk_acknowledged'] ?? false),
            'can_test' => isset($definition['test']),
            'login' => $definition['login'] ?? null,
            'account_name' => $accounts[0]['name'] ?? $integration?->meta['account_name'] ?? null,
            'accounts' => $accounts,
            // * Scopes offered per account (label/description from the provider definition); empty for providers without accounts.
            'account_permissions' => $hasAccounts ? array_map(fn (array $permission): array => [
                'key' => $permission['key'],
                'label' => $permission['label'],
                'description' => $permission['description'],
                'default' => (bool) $permission['default'],
            ], $definition['permissions']) : [],
            // * Zalo only: how an account answers in groups, chosen per account (options come from the provider definition).
            'account_group_modes' => $key === ZaloChannel::PROVIDER ? $this->groupModeOptions($definition) : [],
            // * AI only: the accounts and the choices of the account dialog (empty for other providers).
            'ai_accounts' => $key === 'ai' ? $this->aiAccounts() : [],
            'ai_options' => $key === 'ai' ? [
                'vendors' => array_map(fn (string $value, string $label): array => ['value' => $value, 'label' => $label], array_keys(AiAccount::VENDORS), AiAccount::VENDORS),
                'auth_types' => array_map(fn (string $value, string $label): array => ['value' => $value, 'label' => $label], array_keys(AiAccount::AUTH_TYPES), AiAccount::AUTH_TYPES),
                'purposes' => array_map(fn (string $value, string $label): array => ['value' => $value, 'label' => $label], array_keys(AiAccount::PURPOSES), AiAccount::PURPOSES),
            ] : null,
            'oauth' => ($definition['login'] ?? null) === 'oauth' ? $this->presentOAuth($integration) : null,
            'fields' => $fields,
            'permissions' => $permissions,
            'steps' => $definition['steps'],
            'security_notes' => config('integrations.security_notes'),
            'active' => $active,
            'status' => $status,
            'status_label' => $this->statusLabel($status, $active, $key),
            'last_checked_at' => $integration?->last_checked_at?->toIso8601String(),
            'last_error' => $integration?->last_error,
        ];
    }

    /**
     * Signed-in Messenger accounts for the page (connected first): profile, status and the avatar route, never a login id or cookie.
     *
     * @return array<int, array{id: int, name: string|null, avatar_url: string|null, status: string, last_error: string|null, connected_at: string|null, last_checked_at: string|null, permissions: list<string>}>
     */
    private function messengerAccounts(?Integration $integration): array
    {
        if ($integration === null) {
            return [];
        }

        return app(MessengerChannel::class)->accounts($integration)
            ->sortBy(fn (MessengerAccount $account): int => $account->status === Integration::STATUS_DISCONNECTED ? 1 : 0)
            ->map(fn (MessengerAccount $account): array => [
                'id' => $account->id,
                'name' => $account->name,
                'avatar_url' => $account->avatar_path === null ? null : route('integrations.messenger.accounts.avatar', $account, false).'?v='.substr(md5($account->avatar_path), 0, 8),
                'status' => $account->status,
                'last_error' => $account->last_error,
                'connected_at' => $account->connected_at?->toIso8601String(),
                // * When the bridge state of this account was last read (login check or "Kiểm tra kết nối").
                'last_checked_at' => $account->bridge_state_at?->toIso8601String(),
                'permissions' => $account->effectivePermissions(),
            ])
            ->values()
            ->all();
    }

    /**
     * Signed-in Zalo accounts for the page (connected first): name, status and scopes, never the uid or the session.
     *
     * @return array<int, array{id: int, name: string|null, avatar_url: null, status: string, last_error: string|null, connected_at: string|null, last_checked_at: string|null, permissions: list<string>, group_mode: string}>
     */
    private function zaloAccounts(?Integration $integration): array
    {
        if ($integration === null) {
            return [];
        }

        return app(ZaloChannel::class)->accounts($integration)
            ->sortBy(fn (ZaloAccount $account): int => $account->status === Integration::STATUS_DISCONNECTED ? 1 : 0)
            ->map(fn (ZaloAccount $account): array => [
                'id' => $account->id,
                'name' => $account->name,
                'avatar_url' => null,
                'status' => $account->status,
                'last_error' => $account->last_error,
                'connected_at' => $account->connected_at?->toIso8601String(),
                // * When the sidecar last reported this account's state.
                'last_checked_at' => $account->bridge_state_at?->toIso8601String(),
                'permissions' => $account->effectivePermissions(),
                'group_mode' => $account->effectiveGroupMode(),
            ])
            ->values()
            ->all();
    }

    /**
     * @param  Definition  $definition
     * @return list<array{value: string, label: string}>
     */
    private function groupModeOptions(array $definition): array
    {
        $field = collect($definition['fields'])->firstWhere('key', 'group_mode');
        $options = [];

        foreach ((array) ($field['options'] ?? []) as $value => $label) {
            $options[] = ['value' => (string) $value, 'label' => $label];
        }

        return $options;
    }

    /**
     * Sign-in state for the page: no token, only whether the app is configured and when the stored token expires.
     *
     * @return array{configured: bool, connected_via: ?string, expires_at: ?string, expiry: ?string}
     */
    private function presentOAuth(?Integration $integration): array
    {
        $raw = $integration?->meta['expires_at'] ?? null;
        $expiresAt = is_string($raw) ? Date::parse($raw) : null;

        return [
            'configured' => app(LinkedInOAuth::class)->isConfigured(),
            'connected_via' => $integration?->meta['connected_via'] ?? null,
            'expires_at' => $expiresAt?->toIso8601String(),
            // * `expired` / `expiring` (< 7 days) / `ok`; null when no expiry is known (manual token).
            'expiry' => match (true) {
                $expiresAt === null => null,
                $expiresAt->isPast() => 'expired',
                $expiresAt->lt(now()->addDays(7)) => 'expiring',
                default => 'ok',
            },
        ];
    }
}
