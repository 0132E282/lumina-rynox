<?php

declare(strict_types=1);

namespace App\Services\Chat\Telegram;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** * Turns Telegram `message` updates into `Conversation` + `ChatMessage` rows. Re-delivered updates are ignored (unique `external_message_id`). */
final class TelegramInbox
{
    // * Message keys checked in order; the first present one names the unsupported type.
    private const UNSUPPORTED_TYPES = [
        'photo' => 'ảnh',
        'sticker' => 'sticker',
        'voice' => 'tin nhắn thoại',
        'video' => 'video',
        'video_note' => 'video tròn',
        'animation' => 'ảnh động',
        'audio' => 'âm thanh',
        'document' => 'tệp',
        'location' => 'vị trí',
        'venue' => 'địa điểm',
        'contact' => 'danh bạ',
        'poll' => 'bình chọn',
        'dice' => 'xúc xắc',
    ];

    private const PREVIEW_LENGTH = 120;

    /**
     * @param  list<array<string, mixed>>  $updates
     * @return array{stored: int, nextOffset: int|null} `nextOffset` is the highest `update_id` + 1, to acknowledge to Telegram
     */
    public function ingest(Integration $integration, array $updates): array
    {
        $stored = 0;
        $highest = null;

        foreach ($updates as $update) {
            $updateId = $update['update_id'] ?? null;

            if (! is_int($updateId)) {
                continue;
            }

            $highest = max($highest ?? $updateId, $updateId);

            if (is_array($update['message'] ?? null) && $this->storeMessage($integration, $update['message'])) {
                $stored++;
            }
        }

        return ['stored' => $stored, 'nextOffset' => $highest === null ? null : $highest + 1];
    }

    /** @param array<string, mixed> $message */
    private function storeMessage(Integration $integration, array $message): bool
    {
        $chat = $message['chat'] ?? null;
        $chatId = is_array($chat) ? ($chat['id'] ?? null) : null;
        $messageId = $message['message_id'] ?? null;
        $type = $this->conversationType($chat['type'] ?? null);

        // * Channels and malformed payloads are not conversations.
        if (! is_int($chatId) || ! is_int($messageId) || $type === null) {
            return false;
        }

        $body = $this->body($message);
        $sentAt = CarbonImmutable::createFromTimestamp(is_int($message['date'] ?? null) ? $message['date'] : time());
        $sender = is_array($message['from'] ?? null) ? $message['from'] : [];

        return DB::transaction(function () use ($integration, $chat, $chatId, $messageId, $type, $body, $sentAt, $sender): bool {
            $conversation = Conversation::query()->createOrFirst(
                ['provider' => TelegramChannel::PROVIDER, 'external_chat_id' => (string) $chatId],
                ['integration_id' => $integration->id, 'type' => $type, 'title' => $this->title($chat, $sender)],
            );

            $stored = ChatMessage::query()->createOrFirst(
                ['conversation_id' => $conversation->id, 'external_message_id' => (string) $messageId],
                [
                    'direction' => ChatMessage::DIRECTION_IN,
                    'sender_type' => ChatMessage::SENDER_CUSTOMER,
                    'sender_name' => $this->personName($sender),
                    'body' => $body,
                    'sent_at' => $sentAt,
                ],
            );

            if (! $stored->wasRecentlyCreated) {
                return false;
            }

            $conversation->fill([
                'integration_id' => $integration->id,
                'type' => $type,
                'title' => $this->title($chat, $sender),
                'username' => $this->stringOrNull($chat['username'] ?? null),
            ]);

            // * Only a newer message moves the preview, so a late batch cannot roll the list back.
            if ($conversation->last_message_at === null || $sentAt >= $conversation->last_message_at) {
                $conversation->fill([
                    'last_message_preview' => Str::limit(preg_replace('/\s+/u', ' ', $body) ?? $body, self::PREVIEW_LENGTH),
                    'last_message_direction' => ChatMessage::DIRECTION_IN,
                    'last_message_at' => $sentAt,
                ]);
            }

            $conversation->unread_count++;
            $conversation->save();

            return true;
        });
    }

    /** @param array<string, mixed> $message */
    private function body(array $message): string
    {
        if (is_string($message['text'] ?? null) && $message['text'] !== '') {
            return $message['text'];
        }

        $label = 'khác';

        foreach (self::UNSUPPORTED_TYPES as $key => $name) {
            if (array_key_exists($key, $message)) {
                $label = $name;
                break;
            }
        }

        $caption = is_string($message['caption'] ?? null) ? $message['caption'] : '';

        return trim("Loại tin chưa hỗ trợ: {$label}\n{$caption}");
    }

    private function conversationType(mixed $telegramType): ?string
    {
        return match ($telegramType) {
            'private' => Conversation::TYPE_PRIVATE,
            'group', 'supergroup' => Conversation::TYPE_GROUP,
            default => null,
        };
    }

    /**
     * @param  array<string, mixed>  $chat
     * @param  array<string, mixed>  $sender
     */
    private function title(array $chat, array $sender): string
    {
        $title = $this->stringOrNull($chat['title'] ?? null)
            ?? $this->personName($chat)
            ?? $this->personName($sender)
            ?? $this->stringOrNull($chat['username'] ?? null)
            ?? 'Telegram '.$chat['id'];

        return Str::limit($title, 255, '');
    }

    /** @param array<string, mixed> $person */
    private function personName(array $person): ?string
    {
        $name = trim(($this->stringOrNull($person['first_name'] ?? null) ?? '').' '.($this->stringOrNull($person['last_name'] ?? null) ?? ''));

        return $name !== '' ? $name : $this->stringOrNull($person['username'] ?? null);
    }

    private function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }
}
