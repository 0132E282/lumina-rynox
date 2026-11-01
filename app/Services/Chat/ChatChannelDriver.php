<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Models\Conversation;
use App\Models\Integration;

/**
 * A chat channel with several accounts (Zalo, Messenger): registered with `ChatChannels::register()`, so the host does not import
 * channel classes. Telegram stays wired directly in `ChatChannels`.
 */
interface ChatChannelDriver
{
    /** * The `conversations.provider` / `integrations.provider` value. */
    public function provider(): string;

    public function label(): string;

    public function sender(): ChatSender;

    /**
     * Channel-level extras for the page: `display_name`, `account`, `account_count`, `can_send`. Never credentials.
     *
     * @return array{display_name: ?string, account: ?string, account_count: int, can_send: bool}
     */
    public function presentChannel(?Integration $integration): array;

    /**
     * Relations the conversation list eager loads for `presentConversation()`.
     *
     * @return list<string>
     */
    public function conversationRelations(): array;

    /**
     * Extra keys merged into one presented conversation of this channel.
     *
     * @return array<string, mixed>
     */
    public function presentConversation(Conversation $conversation): array;
}
