<?php

declare(strict_types=1);

namespace App\Services\Chat\Zalo;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\ZaloAccount;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Turns a sidecar `inbound` payload into `Conversation` + `ChatMessage` rows. A re-delivered message is ignored (unique `external_message_id`).
 *
 * @phpstan-type Payload array{message_id: string, thread_id: string, thread_type: string, thread_name: ?string, sender_id: string, sender_name: ?string, is_self: bool, content_type: string, text: ?string, mentions_self: bool, sent_at_ms: int}
 */
final class ZaloInbox
{
    public const CONTENT_TYPES = ['text', 'image', 'sticker', 'file', 'voice', 'video', 'link', 'other'];

    private const UNSUPPORTED_LABELS = [
        'image' => 'ảnh',
        'sticker' => 'sticker',
        'file' => 'tệp',
        'voice' => 'tin nhắn thoại',
        'video' => 'video',
        'link' => 'liên kết',
    ];

    private const PREVIEW_LENGTH = 120;

    public function __construct(private readonly ZaloChannel $channel) {}

    /**
     * @param  Payload  $payload
     * @return bool `true` when a new message was stored; `false` when it was filtered out or already stored
     */
    public function ingest(ZaloAccount $account, array $payload): bool
    {
        if (! $this->accepts($account, $payload)) {
            return false;
        }

        $isGroup = $payload['thread_type'] === 'group';
        $type = $isGroup ? Conversation::TYPE_GROUP : Conversation::TYPE_PRIVATE;
        $body = $this->body($payload);
        $sentAt = $payload['sent_at_ms'] > 0 ? CarbonImmutable::createFromTimestampMs($payload['sent_at_ms']) : CarbonImmutable::now();
        $name = $this->name($payload, $isGroup);

        return DB::transaction(function () use ($account, $payload, $type, $body, $sentAt, $name): bool {
            // * One conversation per account and contact: two accounts talking to the same friend keep separate chats.
            $conversation = Conversation::query()->createOrFirst(
                ['provider' => ZaloChannel::PROVIDER, 'external_chat_id' => $payload['thread_id'], 'account_scope' => $account->id],
                ['integration_id' => $account->integration_id, 'zalo_account_id' => $account->id, 'type' => $type, 'title' => Str::limit($name ?? 'Zalo '.$payload['thread_id'], 255, '')],
            );

            $stored = ChatMessage::query()->createOrFirst(
                ['conversation_id' => $conversation->id, 'external_message_id' => $payload['message_id']],
                [
                    'direction' => ChatMessage::DIRECTION_IN,
                    'sender_type' => ChatMessage::SENDER_CUSTOMER,
                    'sender_name' => $payload['sender_name'] === null ? null : Str::limit($payload['sender_name'], 255, ''),
                    'body' => $body,
                    'sent_at' => $sentAt,
                ],
            );

            if (! $stored->wasRecentlyCreated) {
                return false;
            }

            $conversation->fill(['integration_id' => $account->integration_id, 'zalo_account_id' => $account->id, 'type' => $type]);

            // * A real name replaces the placeholder title; a message without one never overwrites a known title.
            if ($name !== null) {
                $conversation->title = Str::limit($name, 255, '');
            }

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

    /** @param Payload $payload */
    private function accepts(ZaloAccount $account, array $payload): bool
    {
        if ($account->status !== Integration::STATUS_CONNECTED || $this->channel->credentials($account) === null) {
            return false;
        }

        // * Messages the owner sent from another device are not stored: they would duplicate what staff send from the app.
        if ($payload['is_self'] || ! $account->allows('receive')) {
            return false;
        }

        if ($payload['thread_type'] !== 'group') {
            return true;
        }

        return match ($account->effectiveGroupMode()) {
            ZaloAccount::GROUP_MODE_ALL => true,
            ZaloAccount::GROUP_MODE_OFF => false,
            default => $payload['mentions_self'],
        };
    }

    /** @param Payload $payload */
    private function body(array $payload): string
    {
        if ($payload['content_type'] === 'text' && is_string($payload['text']) && $payload['text'] !== '') {
            return $payload['text'];
        }

        return 'Loại tin chưa hỗ trợ: '.(self::UNSUPPORTED_LABELS[$payload['content_type']] ?? 'khác');
    }

    /** @param Payload $payload */
    private function name(array $payload, bool $isGroup): ?string
    {
        $candidates = $isGroup ? [$payload['thread_name']] : [$payload['sender_name'], $payload['thread_name']];

        foreach ($candidates as $candidate) {
            if (is_string($candidate) && trim($candidate) !== '') {
                return trim($candidate);
            }
        }

        return null;
    }
}
