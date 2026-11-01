<?php

declare(strict_types=1);

namespace App\Services\Chat\Messenger;

use App\Models\Integration;
use App\Models\MessengerAccount;
use Illuminate\Database\Eloquent\Collection;

/** * Entry to the stored Messenger `Integration` and its `MessengerAccount` rows: the only place that reads the bridge login state and writes it back. */
final class MessengerChannel
{
    public const PROVIDER = 'messenger';

    public const NOT_CONFIGURED = 'Chưa cấu hình Messenger bridge.';

    public const BRIDGE_DOWN = 'Messenger bridge không chạy.';

    public const NO_LOGIN = 'Messenger chưa đăng nhập trên bridge, hãy đăng nhập lại.';

    public const TOKEN_INVALID = 'Token Matrix của app không hợp lệ, kiểm tra MATRIX_ACCESS_TOKEN.';

    // * bridgev2 login states this channel maps to a fixed message; any other non-transient state reads as `UNKNOWN_ERROR`.
    public const ERROR_MESSAGES = [
        'BAD_CREDENTIALS' => 'Phiên Facebook đã hết hạn hoặc bị chặn, hãy dán cookie mới để đăng nhập lại.',
        'UNKNOWN_ERROR' => 'Messenger bridge gặp lỗi, hãy kiểm tra kết nối hoặc thử lại sau.',
    ];

    // * States that mean the bridge is still working on the connection; the stored status is left untouched.
    private const TRANSIENT_STATES = ['CONNECTING', 'TRANSIENT_DISCONNECT'];

    public function integration(): ?Integration
    {
        return Integration::query()->where('provider', self::PROVIDER)->first();
    }

    /** @return Collection<int, MessengerAccount> */
    public function accounts(?Integration $integration = null): Collection
    {
        $integration ??= $this->integration();

        return $integration === null
            ? new Collection
            : MessengerAccount::query()->where('integration_id', $integration->id)->orderBy('id')->get();
    }

    /** * The integration while it is `connected` and at least one account is signed in; null otherwise. */
    public function connected(): ?Integration
    {
        $integration = $this->integration();

        return $integration?->status === Integration::STATUS_CONNECTED
            && MessengerAccount::query()->where('integration_id', $integration->id)->where('status', Integration::STATUS_CONNECTED)->exists()
            ? $integration
            : null;
    }

    public function configured(): bool
    {
        return (string) config('services.matrix.homeserver_url') !== ''
            && (string) config('services.matrix.user_id') !== ''
            && (string) config('services.matrix.access_token') !== ''
            && (string) config('services.mautrix_meta.provisioning_url') !== ''
            && (string) config('services.mautrix_meta.provisioning_secret') !== ''
            && (string) config('services.mautrix_meta.bot_user_id') !== '';
    }

    /**
     * Records what the bridge reported for one account's login (`null` = the login is gone from the bridge).
     * `CONNECTING` and `TRANSIENT_DISCONNECT` leave the stored status untouched; `CONNECTED` restores `connected`;
     * anything else puts the account in `error` with a fixed text. The channel status is then re-derived.
     */
    public function markAccountState(MessengerAccount $account, ?string $state, ?string $name = null): void
    {
        $account->bridge_state = $state;
        $account->bridge_state_at = now();

        // * The bridge reports the signed-in profile name; it is shown as the account and as the sender of our own messages.
        if ($name !== null && $name !== '') {
            $account->name = $name;
        }

        if ($state !== null && in_array($state, self::TRANSIENT_STATES, true)) {
            $account->save();

            return;
        }

        if ($state === 'CONNECTED') {
            $account->forceFill(['status' => Integration::STATUS_CONNECTED, 'last_error' => null]);
        } else {
            $message = $state === null ? self::NO_LOGIN : (self::ERROR_MESSAGES[$state] ?? self::ERROR_MESSAGES['UNKNOWN_ERROR']);
            $account->forceFill(['status' => Integration::STATUS_ERROR, 'last_error' => $message]);
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

    public function markTokenInvalid(Integration $integration): void
    {
        $integration->forceFill([
            'status' => Integration::STATUS_ERROR,
            'last_error' => self::TOKEN_INVALID,
            'last_checked_at' => now(),
        ])->save();
    }
}
