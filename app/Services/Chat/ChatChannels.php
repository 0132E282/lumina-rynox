<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Models\Conversation;
use App\Models\Integration;
use App\Services\Chat\Telegram\TelegramChannel;
use App\Services\Chat\Telegram\TelegramSender;

/** * Registry of chat channels: maps a conversation's `provider` to the sender that can answer it. */
final class ChatChannels
{
    public function __construct(
        private readonly TelegramSender $telegramSender,
        private readonly TelegramChannel $telegramChannel,
    ) {}

    /** @var array<string, ChatChannelDriver> */
    private array $drivers = [];

    /** * Adds a driver-based channel (Zalo, Messenger); listed after Telegram in registration order. */
    public function register(ChatChannelDriver $driver): void
    {
        $this->drivers[$driver->provider()] = $driver;
    }

    /** @return list<string> relations to eager load on the conversation list */
    public function conversationRelations(): array
    {
        return array_values(array_unique(array_merge(...array_map(fn (ChatChannelDriver $driver): array => $driver->conversationRelations(), array_values($this->drivers)))));
    }

    /** @return array<string, mixed> plugin-provided keys of a presented conversation (empty on Telegram) */
    public function presentConversation(Conversation $conversation): array
    {
        return isset($this->drivers[$conversation->provider]) ? $this->drivers[$conversation->provider]->presentConversation($conversation) : [];
    }

    /** @return list<string> */
    public function providers(): array
    {
        return [TelegramChannel::PROVIDER, ...array_keys($this->drivers)];
    }

    /** * An unknown provider is a conversation this app cannot answer: 404. */
    public function sender(string $provider): ChatSender
    {
        return match ($provider) {
            TelegramChannel::PROVIDER => $this->telegramSender,
            default => ($this->drivers[$provider] ?? null)?->sender() ?? abort(404),
        };
    }

    /**
     * Client-safe state of every channel from one query; never includes credentials.
     *
     * @return array<string, array<string, mixed>>
     */
    public function presentAll(): array
    {
        $integrations = Integration::query()->whereIn('provider', $this->providers())->get()->keyBy('provider');
        $channels = [];

        foreach ($this->providers() as $provider) {
            $channels[$provider] = $this->present($provider, $integrations->get($provider));
        }

        return $channels;
    }

    /** @return array<string, mixed> never includes credentials */
    public function present(string $provider, ?Integration $integration): array
    {
        $status = $integration->status ?? Integration::STATUS_DISCONNECTED;
        $driver = $this->drivers[$provider] ?? null;
        $extras = $driver?->presentChannel($integration);

        return [
            'provider' => $provider,
            'name' => $driver?->label() ?? 'Telegram',
            'status' => $status,
            'connected' => $status === Integration::STATUS_CONNECTED,
            'last_error' => $integration?->last_error,
            'display_name' => $driver !== null ? $extras['display_name'] : ($integration->settings['fields']['display_name'] ?? null),
            'bot_username' => $provider === TelegramChannel::PROVIDER ? ($integration->meta['bot_username'] ?? null) : null,
            'account' => $extras['account'] ?? null,
            'account_count' => $extras['account_count'] ?? 0,
            'can_send' => $integration !== null && ($driver !== null ? $extras['can_send'] : $this->telegramChannel->allows($integration, 'send')),
        ];
    }
}
