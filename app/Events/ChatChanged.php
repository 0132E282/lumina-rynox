<?php

declare(strict_types=1);

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

/**
 * "Something changed in /chat" signal. Carries only kinds and internal conversation ids: the browser reloads
 * the real data from Laravel, so no message content, names or credentials ever reach the broadcast provider.
 * Sent synchronously (`ShouldBroadcastNow`) because the queue is `database` and no worker runs.
 */
final class ChatChanged implements ShouldBroadcastNow
{
    public const KIND_MESSAGE_CREATED = 'message.created';

    public const KIND_MESSAGE_STATUS = 'message.status';

    public const KIND_CONVERSATION_UPDATED = 'conversation.updated';

    public const KIND_CHANNEL_STATUS = 'channel.status';

    public const MAX_CONVERSATION_IDS = 50;

    /**
     * @param  list<string>  $kinds
     * @param  list<string>  $conversationIds
     */
    public function __construct(
        public readonly array $kinds,
        public readonly array $conversationIds,
    ) {}

    public function broadcastOn(): Channel
    {
        return new PrivateChannel('chat');
    }

    public function broadcastAs(): string
    {
        return 'chat.changed';
    }

    /** @return array{kinds: list<string>, conversation_ids: list<string>} */
    public function broadcastWith(): array
    {
        return [
            'kinds' => array_values(array_unique($this->kinds)),
            'conversation_ids' => array_slice(array_values(array_unique($this->conversationIds)), 0, self::MAX_CONVERSATION_IDS),
        ];
    }
}
