<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Models\ChatMessage;
use App\Models\Conversation;

/**
 * * Reads a conversation and its messages the way the chat screens show them. Shared by `/chat` and `/inbox` so both open a thread identically.
 *
 * @phpstan-type MessagePage array{data: array<int, array<string, mixed>>, has_more: bool}
 */
final class ChatThreadPresenter
{
    public const MESSAGE_PAGE_SIZE = 50;

    // * A `sending` row this old lost its request (crashed worker); the outcome is unknown, so it is shown as such.
    private const STALE_SENDING_MINUTES = 2;

    public function __construct(private readonly ChatChannels $channels) {}

    /** * Opening a conversation clears its unread count and settles `sending` rows that lost their request. */
    public function markRead(Conversation $conversation): void
    {
        if ($conversation->unread_count > 0) {
            $conversation->forceFill(['unread_count' => 0])->save();
        }

        ChatMessage::query()
            ->where('conversation_id', $conversation->id)
            ->where('send_status', ChatMessage::STATUS_SENDING)
            ->where('updated_at', '<', now()->subMinutes(self::STALE_SENDING_MINUTES))
            ->update(['send_status' => ChatMessage::STATUS_UNKNOWN, 'error' => 'Không nhận được phản hồi, tin có thể đã được gửi.']);
    }

    /** @return MessagePage */
    public function messagePage(Conversation $conversation, ?int $before): array
    {
        // * Backfilled history is stored after newer messages, so order and page by send time; the id breaks ties.
        $sentAt = 'coalesce(sent_at, created_at)';
        $cursor = $before === null ? null : ChatMessage::query()->where('conversation_id', $conversation->id)->selectRaw("id, {$sentAt} as at")->find($before);

        $rows = ChatMessage::query()
            ->where('conversation_id', $conversation->id)
            ->when($cursor !== null, fn ($query) => $query->whereRaw("({$sentAt} < ? or ({$sentAt} = ? and id < ?))", [$cursor->getAttribute('at'), $cursor->getAttribute('at'), $cursor->id]))
            ->orderByRaw("{$sentAt} desc")
            ->orderByDesc('id')
            ->limit(self::MESSAGE_PAGE_SIZE + 1)
            ->get();

        return [
            'data' => $rows->take(self::MESSAGE_PAGE_SIZE)->reverse()->values()
                ->map(fn (ChatMessage $message): array => $this->presentMessage($message))
                ->values()
                ->all(),
            'has_more' => $rows->count() > self::MESSAGE_PAGE_SIZE,
        ];
    }

    /** @return array<string, mixed> */
    public function presentConversation(Conversation $conversation): array
    {
        return [
            // * Channel plugins (Messenger) override `account` with the account this chat belongs to.
            'account' => null,
            ...$this->channels->presentConversation($conversation),
            'id' => $conversation->id,
            'provider' => $conversation->provider,
            'type' => $conversation->type,
            'title' => $conversation->title,
            'username' => $conversation->username,
            'last_message_preview' => $conversation->last_message_preview,
            'last_message_direction' => $conversation->last_message_direction,
            'last_message_at' => $conversation->last_message_at?->toIso8601String(),
            'unread_count' => $conversation->unread_count,
            'pinned' => $conversation->pinned_at !== null,
            // * Version in the query so a changed picture bypasses the browser cache.
            'avatar_url' => $conversation->avatar_path === null ? null : route('chat.avatar', $conversation, false).'?v='.substr(md5($conversation->avatar_path), 0, 8),
        ];
    }

    /** @return array<string, mixed> */
    private function presentMessage(ChatMessage $message): array
    {
        return [
            'id' => $message->id,
            'direction' => $message->direction,
            'sender_type' => $message->sender_type,
            'sender_name' => $message->sender_name,
            'body' => $message->body,
            'attachment' => $message->attachment_path === null && $message->attachment_mxc === null ? null : [
                'url' => route('chat.attachment', $message, false),
                'width' => $message->attachment_width,
                'height' => $message->attachment_height,
                'name' => $message->attachment_name,
                'size' => $message->attachment_size,
                'is_audio' => str_starts_with((string) $message->attachment_mime, 'audio/'),
                'is_video' => str_starts_with((string) $message->attachment_mime, 'video/'),
                'is_image' => str_starts_with((string) $message->attachment_mime, 'image/'),
            ],
            'send_status' => $message->send_status,
            'error' => $message->error,
            'sent_at' => $message->sent_at?->toIso8601String(),
        ];
    }
}
