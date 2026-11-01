<?php

declare(strict_types=1);

namespace App\Services\Chat\Telegram;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Services\Chat\ChatSender;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Sends staff replies. One attempt per call: a timeout or 5xx leaves the message `unknown` (it may have been delivered),
 * and only an explicit manual `resend()` tries again. There is no automatic retry anywhere.
 */
final class TelegramSender implements ChatSender
{
    private const PREVIEW_LENGTH = 120;

    private const ERROR_LENGTH = 500;

    public function __construct(private readonly TelegramChannel $channel) {}

    /** * The conversation is not needed: one bot serves every Telegram chat. */
    public function ensureCanSend(?Conversation $conversation = null): Integration
    {
        $integration = $this->channel->integration();

        if ($integration === null || $integration->status !== Integration::STATUS_CONNECTED) {
            throw new ChatUnavailableException('Telegram đang mất kết nối, chưa thể gửi tin.');
        }

        if (! $this->channel->allows($integration, 'send')) {
            throw new ChatUnavailableException('Quyền "Gửi tin nhắn" của Telegram đang tắt.');
        }

        return $this->channel->connected() ?? throw new ChatUnavailableException('Chưa lưu Bot token Telegram.');
    }

    public function sendAttachment(Conversation $conversation, UploadedFile $file, string $caption, string $clientToken, ?string $staffName): ChatMessage
    {
        throw new ChatUnavailableException('Kênh này chưa hỗ trợ gửi file.');
    }

    /** * A repeated `$clientToken` returns the stored message untouched, so a double submit cannot send twice. */
    public function send(Conversation $conversation, string $body, string $clientToken, ?string $staffName): ChatMessage
    {
        $integration = $this->ensureCanSend();

        $message = DB::transaction(function () use ($conversation, $body, $clientToken, $staffName): ChatMessage {
            $message = ChatMessage::query()->createOrFirst(
                ['conversation_id' => $conversation->id, 'client_token' => $clientToken],
                [
                    'direction' => ChatMessage::DIRECTION_OUT,
                    'sender_type' => ChatMessage::SENDER_STAFF,
                    'sender_name' => $staffName,
                    'body' => $body,
                    'send_status' => ChatMessage::STATUS_SENDING,
                    'sent_at' => now(),
                ],
            );

            if ($message->wasRecentlyCreated) {
                $conversation->forceFill([
                    'last_message_preview' => Str::limit(preg_replace('/\s+/u', ' ', $body) ?? $body, self::PREVIEW_LENGTH),
                    'last_message_direction' => ChatMessage::DIRECTION_OUT,
                    'last_message_at' => $message->sent_at,
                ])->save();
            }

            return $message;
        });

        return $message->wasRecentlyCreated ? $this->deliver($message, $conversation, $integration) : $message;
    }

    /**
     * * Manual retry of a `unknown` or `failed` message. The status flip is one atomic UPDATE, so a second click while the
     * * first attempt runs claims nothing and returns null.
     *
     * @throws ChatUnavailableException
     */
    public function resend(ChatMessage $message): ?ChatMessage
    {
        $integration = $this->ensureCanSend();

        $claimed = ChatMessage::query()
            ->whereKey($message->id)
            ->where('direction', ChatMessage::DIRECTION_OUT)
            ->whereIn('send_status', [ChatMessage::STATUS_UNKNOWN, ChatMessage::STATUS_FAILED])
            ->update(['send_status' => ChatMessage::STATUS_SENDING, 'error' => null, 'updated_at' => now()]);

        if ($claimed === 0) {
            return null;
        }

        $message->refresh();

        return $this->deliver($message, $message->conversation, $integration);
    }

    private function deliver(ChatMessage $message, Conversation $conversation, Integration $integration): ChatMessage
    {
        try {
            $sent = $this->channel->client($integration)->sendMessage($conversation->external_chat_id, $message->body);
        } catch (ConnectionException) {
            // ! The exception message holds the request URL (token): only a fixed text is stored.
            return $this->settle($message, ChatMessage::STATUS_UNKNOWN, 'Hết thời gian chờ Telegram, tin có thể đã được gửi.');
        } catch (TelegramApiException $exception) {
            if ($exception->isAuthFailure()) {
                $this->channel->markAuthFailed($integration);
            }

            return $exception->isAmbiguous()
                ? $this->settle($message, ChatMessage::STATUS_UNKNOWN, 'Telegram lỗi tạm thời, tin có thể đã được gửi.')
                : $this->settle($message, ChatMessage::STATUS_FAILED, $exception->isAuthFailure() ? TelegramChannel::AUTH_ERROR : $exception->getMessage());
        }

        $externalId = $sent['message_id'] ?? null;

        $message->forceFill([
            'send_status' => ChatMessage::STATUS_SENT,
            'error' => null,
            'external_message_id' => is_int($externalId) ? (string) $externalId : null,
            'sent_at' => now(),
        ])->save();

        return $message;
    }

    private function settle(ChatMessage $message, string $status, string $error): ChatMessage
    {
        $message->forceFill(['send_status' => $status, 'error' => Str::limit($error, self::ERROR_LENGTH)])->save();

        return $message;
    }
}
