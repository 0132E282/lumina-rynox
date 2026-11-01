<?php

declare(strict_types=1);

namespace App\Services\Chat\Telegram;

use App\Models\Integration;

/** * Entry to the stored Telegram `Integration`: the only place that reads the token and records a lost connection. */
final class TelegramChannel
{
    public const PROVIDER = 'telegram';

    public const OFFSET_KEY = 'telegram_offset';

    public const AUTH_ERROR = 'Bot token không hợp lệ hoặc đã bị thu hồi.';

    public function integration(): ?Integration
    {
        return Integration::query()->where('provider', self::PROVIDER)->first();
    }

    public function connected(): ?Integration
    {
        $integration = $this->integration();

        return $integration?->status === Integration::STATUS_CONNECTED && filled($this->token($integration))
            ? $integration
            : null;
    }

    public function client(Integration $integration): TelegramClient
    {
        return new TelegramClient((string) $this->token($integration));
    }

    /** * `settings.permissions` lists the scopes ticked on the integration page; a connection saved without any keeps the defaults (all on). */
    public function allows(Integration $integration, string $permission): bool
    {
        $permissions = $integration->settings['permissions'] ?? null;

        return ! is_array($permissions) || in_array($permission, $permissions, true);
    }

    /** * The UI reads this to show "Mất kết nối" and lock the composer. */
    public function markAuthFailed(Integration $integration): void
    {
        $integration->forceFill([
            'status' => Integration::STATUS_ERROR,
            'last_error' => self::AUTH_ERROR,
            'last_checked_at' => now(),
        ])->save();
    }

    private function token(Integration $integration): ?string
    {
        $token = $integration->credentials['bot_token'] ?? null;

        return is_string($token) ? $token : null;
    }
}
