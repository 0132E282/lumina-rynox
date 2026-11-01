<?php

declare(strict_types=1);

namespace App\Services\Chat\Zalo;

use App\Models\Conversation;
use App\Models\Integration;
use App\Models\ZaloAccount;
use Illuminate\Database\Eloquent\Collection;

/** * Entry to the stored Zalo `Integration` and its `ZaloAccount` rows: the only place that reads session credentials and records the bridge state per account. */
final class ZaloChannel
{
    public const PROVIDER = 'zalo';

    // * Keys that make a session usable; the sidecar sends all three.
    public const CREDENTIAL_KEYS = ['cookie', 'imei', 'user_agent'];

    // * States the sidecar may report (`/health`, `/internal/zalo/status`).
    public const STATES = ['idle', 'qr_pending', 'connecting', 'running', 'reconnecting', 'session_lost', 'displaced', 'stopped', 'reconnect_exhausted'];

    // * Failures that put an account in `error`; the text is fixed, never the sidecar's own message.
    public const ERROR_MESSAGES = [
        'session_lost' => 'Phiên Zalo đã hết hạn hoặc bị đăng xuất, hãy quét mã QR lại.',
        'displaced' => 'Zalo Web đang mở ở nơi khác, hãy đóng rồi kết nối lại.',
        'reconnect_exhausted' => 'Không kết nối lại được với Zalo sau nhiều lần thử.',
    ];

    public function integration(): ?Integration
    {
        return Integration::query()->where('provider', self::PROVIDER)->first();
    }

    /** @return Collection<int, ZaloAccount> */
    public function accounts(?Integration $integration = null): Collection
    {
        $integration ??= $this->integration();

        return $integration === null
            ? new Collection
            : ZaloAccount::query()->where('integration_id', $integration->id)->orderBy('id')->get();
    }

    /** * The integration while it is `connected` and at least one account is signed in; null otherwise. */
    public function connected(): ?Integration
    {
        $integration = $this->integration();

        return $integration?->status === Integration::STATUS_CONNECTED
            && ZaloAccount::query()->where('integration_id', $integration->id)->where('status', Integration::STATUS_CONNECTED)->exists()
            ? $integration
            : null;
    }

    /**
     * The account a sidecar callback is about. Without a key (an older sidecar) it is the only account, if there is exactly one.
     */
    public function accountForKey(?string $accountKey): ?ZaloAccount
    {
        $integration = $this->integration();

        if ($integration === null) {
            return null;
        }

        if ($accountKey !== null && $accountKey !== '') {
            return ZaloAccount::query()->where('integration_id', $integration->id)->where('account_key', $accountKey)->first();
        }

        $accounts = $this->accounts($integration);

        return $accounts->count() === 1 ? $accounts->first() : null;
    }

    /** * The account that answers a conversation: its own, or the only connected one for a conversation that lost its account. */
    public function accountFor(Conversation $conversation): ?ZaloAccount
    {
        if ($conversation->zalo_account_id !== null) {
            return ZaloAccount::query()->find($conversation->zalo_account_id);
        }

        $connected = $this->accounts()->where('status', Integration::STATUS_CONNECTED);

        return $connected->count() === 1 ? $connected->first() : null;
    }

    /** @return array{cookie: string, imei: string, user_agent: string}|null */
    public function credentials(ZaloAccount $account): ?array
    {
        $stored = $account->credentials;

        if (! is_array($stored)) {
            return null;
        }

        $session = [];

        foreach (self::CREDENTIAL_KEYS as $key) {
            if (! is_string($stored[$key] ?? null) || $stored[$key] === '') {
                return null;
            }

            $session[$key] = $stored[$key];
        }

        return $session;
    }

    /** * Accounts the sidecar should keep a session for: a stored session and not disconnected. */
    /** @return list<string> */
    public function sessionKeys(): array
    {
        return $this->accounts()
            ->filter(fn (ZaloAccount $account): bool => $account->status !== Integration::STATUS_DISCONNECTED && $this->credentials($account) !== null)
            ->map(fn (ZaloAccount $account): string => $account->account_key)
            ->values()
            ->all();
    }

    /**
     * Records what the sidecar reported for one account. A failure state (or `reason_code`) puts a signed-in account in `error`
     * with a fixed text; `running` restores `connected`. Without a stored session nothing changes except the reported state.
     * The channel status is then re-derived from all accounts.
     */
    public function markAccountState(ZaloAccount $account, string $state, ?string $reasonCode = null): void
    {
        $failure = array_key_exists((string) $reasonCode, self::ERROR_MESSAGES)
            ? (string) $reasonCode
            : (array_key_exists($state, self::ERROR_MESSAGES) ? $state : null);
        $hasSession = $this->credentials($account) !== null;

        $account->bridge_state = $state;
        $account->bridge_state_at = now();

        if ($failure !== null && $hasSession) {
            $account->forceFill(['status' => Integration::STATUS_ERROR, 'last_error' => self::ERROR_MESSAGES[$failure]]);
        } elseif ($state === 'running' && $hasSession) {
            $account->forceFill(['status' => Integration::STATUS_CONNECTED, 'last_error' => null]);
        }

        $account->save();
        $this->refreshStatus($account->integration);
    }

    /** * Channel status from its accounts: any connected account = `connected`, else any error = `error`, else `disconnected`. */
    public function refreshStatus(Integration $integration): void
    {
        $accounts = $this->accounts($integration);
        $failed = $accounts->firstWhere('status', Integration::STATUS_ERROR);
        $status = match (true) {
            $accounts->contains('status', Integration::STATUS_CONNECTED) => Integration::STATUS_CONNECTED,
            $failed !== null => Integration::STATUS_ERROR,
            default => Integration::STATUS_DISCONNECTED,
        };

        $integration->forceFill([
            'status' => $status,
            'last_error' => $status === Integration::STATUS_ERROR ? $failed?->last_error : null,
            'last_checked_at' => now(),
        ])->save();
    }
}
