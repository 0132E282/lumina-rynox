<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\Integration;
use App\Models\Post;
use App\Services\Integrations\IntegrationManager;
use Illuminate\Contracts\Container\Container;
use InvalidArgumentException;

/**
 * Catalog of posting platforms (`config/posting.php`) joined with the connection state from the Integration module.
 *
 * @phpstan-type ProviderInfo array{key: string, label: string, letter: string, color: string, account: string|null, connected: bool, selectable: bool, reason: string|null, max_length: int, media_types: list<string>, requires_media: bool, audiences: list<array{value: string, label: string}>}
 */
final class PostProviders
{
    public function __construct(
        private readonly Container $container,
        private readonly IntegrationManager $integrations,
    ) {}

    /** @return list<string> */
    public function keys(): array
    {
        return array_map('strval', array_keys(config('posting.providers', [])));
    }

    public function label(string $provider): string
    {
        return (string) config("posting.providers.{$provider}.label", $provider);
    }

    public function publisher(string $provider): PostPublisher
    {
        $class = config("posting.providers.{$provider}.publisher");

        if (! is_string($class)) {
            throw new InvalidArgumentException("Unknown posting provider [{$provider}].");
        }

        $publisher = $this->container->make($class);

        return $publisher instanceof PostPublisher ? $publisher : throw new InvalidArgumentException("[{$class}] is not a PostPublisher.");
    }

    /**
     * * One query for all connections. A platform is selectable only when its Integration is connected and its "post" scope is on;
     * * otherwise `reason` says why (shown disabled in the form). Secrets are never read here.
     *
     * @return array<string, ProviderInfo>
     */
    public function all(): array
    {
        $integrations = Integration::query()->whereIn('provider', array_column(config('posting.providers', []), 'integration'))->get()->keyBy('provider');
        $result = [];

        foreach (config('posting.providers', []) as $key => $definition) {
            $integration = $integrations->get($definition['integration']);
            $catalog = $this->integrations->definition($definition['integration']);
            $connected = $integration?->status === Integration::STATUS_CONNECTED;
            $allowed = $integration !== null && in_array($definition['permission'], $integration->settings['permissions'] ?? [], true);

            $result[$key] = [
                'key' => $key,
                'label' => $definition['label'],
                'letter' => $catalog['letter'] ?? strtoupper($key[0]),
                'color' => $catalog['color'] ?? '#64748b',
                'account' => $this->account($integration),
                'connected' => $connected,
                'selectable' => $connected && $allowed,
                'reason' => match (true) {
                    ! $connected => 'Chưa kết nối. Vào Tích hợp để kết nối.',
                    ! $allowed => 'Quyền đăng bài đang tắt trong Tích hợp.',
                    default => null,
                },
                'max_length' => min((int) $definition['max_length'], Post::MAX_BODY_LENGTH),
                'media_types' => $definition['media_types'],
                'requires_media' => (bool) $definition['requires_media'],
                'audiences' => array_map(
                    fn (string $value, string $label): array => ['value' => $value, 'label' => $label],
                    array_map('strval', array_keys($definition['audiences'] ?? [])),
                    array_values($definition['audiences'] ?? []),
                ),
            ];
        }

        return $result;
    }

    private function account(?Integration $integration): ?string
    {
        $fields = $integration->settings['fields'] ?? [];
        $account = $fields['account'] ?? $fields['fanpage'] ?? $fields['official_account'] ?? null;

        return is_string($account) && $account !== '' ? $account : null;
    }
}
