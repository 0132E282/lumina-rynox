<?php

declare(strict_types=1);

namespace App\Services\Ai;

use App\Models\Integration;
use Illuminate\Database\QueryException;

/**
 * * The global "Trả lời tự động" switch. One source of truth: the `auto_send` entry of the `ai` integration's `settings.permissions`
 * * (the same permission the Integrations page lists). The failure counter and the last error live in `meta`, never in credentials.
 */
final class AutoReplySwitch
{
    public const PERMISSION = 'auto_send';

    public function enabled(): bool
    {
        try {
            $permissions = $this->integration()?->settings['permissions'] ?? null;
        } catch (QueryException) {
            // * The integrations table is missing (migration not run yet): the switch is off.
            return false;
        }

        return is_array($permissions) && in_array(self::PERMISSION, $permissions, true);
    }

    public function lastError(): ?string
    {
        return $this->integration()?->meta['auto_reply_last_error'] ?? null;
    }

    /** * Turning it on or off by hand clears the failure counter and the last error. */
    public function set(bool $enabled): void
    {
        $integration = Integration::query()->firstOrNew(['provider' => AiAssistant::PROVIDER]);
        $settings = $integration->settings ?? [];
        $permissions = $settings['permissions'] ?? $this->defaultPermissions();
        $permissions = array_values(array_diff($permissions, [self::PERMISSION]));

        if ($enabled) {
            $permissions[] = self::PERMISSION;
        }

        $settings['permissions'] = $permissions;
        $integration->settings = $settings;
        $integration->meta = $this->metaWith($integration, 0, null);
        $integration->status ??= Integration::STATUS_CONNECTED;
        $integration->save();
    }

    public function recordSuccess(): void
    {
        $integration = $this->integration();

        if ($integration !== null && ($integration->meta['auto_reply_failures'] ?? 0) > 0) {
            $integration->meta = $this->metaWith($integration, 0, null);
            $integration->save();
        }
    }

    /** * Stores a fixed error text; the third consecutive failure (configurable) switches the feature off. */
    public function recordFailure(string $error): void
    {
        $integration = $this->integration();

        if ($integration === null) {
            return;
        }

        $failures = (int) ($integration->meta['auto_reply_failures'] ?? 0) + 1;
        $integration->meta = $this->metaWith($integration, $failures, $error);

        if ($failures >= max(1, (int) config('ai.auto_reply.max_failures', 3))) {
            $settings = $integration->settings ?? [];
            $settings['permissions'] = array_values(array_diff($settings['permissions'] ?? [], [self::PERMISSION]));
            $integration->settings = $settings;
        }

        $integration->save();
    }

    private function integration(): ?Integration
    {
        return Integration::query()->where('provider', AiAssistant::PROVIDER)->first();
    }

    /** @return list<string> the permissions that default to on, so enabling the switch keeps the others as the page shows them */
    private function defaultPermissions(): array
    {
        $keys = [];

        foreach ((array) config('integrations.providers.ai.permissions') as $permission) {
            if (($permission['default'] ?? false) && $permission['key'] !== self::PERMISSION) {
                $keys[] = (string) $permission['key'];
            }
        }

        return $keys;
    }

    /** @return array<string, mixed> */
    private function metaWith(Integration $integration, int $failures, ?string $error): array
    {
        return [...($integration->meta ?? []), 'auto_reply_failures' => $failures, 'auto_reply_last_error' => $error];
    }
}
