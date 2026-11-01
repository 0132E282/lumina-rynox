<?php

declare(strict_types=1);

namespace App\Services\Chat\Zalo;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\ZaloAccount;
use App\Services\Chat\ChatSender;
use App\Services\Chat\Telegram\ChatUnavailableException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * Sends staff replies through the Zalo sidecar. One attempt per call: a timeout or 5xx leaves the message `unknown`
 * (it may have been delivered), and only an explicit manual `resend()` tries again. There is no automatic retry anywhere.
 */
final class ZaloSender implements ChatSender
{
    // * Suffixed with the account id: each account has its own send budget.
    private const RATE_LIMIT_KEY = 'zalo-send';

    private const RATE_WINDOW_SECONDS = 60;

    private const PREVIEW_LENGTH = 120;

    private const ERROR_LENGTH = 500;

    public function __construct(
        private readonly ZaloChannel $channel,
        private readonly ZaloBridgeClient $bridge,
    ) {}

    /** @throws ChatUnavailableException */
    public function ensureCanSend(Conversation $conversation): Integration
    {
        $this->ensureAccountCanSend($conversation);

        return $this->channel->integration() ?? throw new ChatUnavailableException('Zalo đang mất kết nối, chưa thể gửi tin.');
    }

    /**
     * Checks everything about the conversation's own account: signed in, `reply` ticked, group mode, `proactive`, its rate limit and its bridge session.
     *
     * @throws ChatUnavailableException
     */
    private function ensureAccountCanSend(Conversation $conversation): ZaloAccount
    {
        $account = $this->channel->accountFor($conversation)
            ?? throw new ChatUnavailableException('Hội thoại này chưa gắn với tài khoản Zalo nào đang kết nối.');

        if ($account->status !== Integration::STATUS_CONNECTED || $this->channel->credentials($account) === null) {
            throw new ChatUnavailableException('Tài khoản Zalo đang mất kết nối, chưa thể gửi tin.');
        }

        if (! $account->allows('reply')) {
            throw new ChatUnavailableException('Quyền "Trả lời tin nhắn" của tài khoản Zalo này đang tắt.');
        }

        if ($conversation->type === Conversation::TYPE_GROUP && $account->effectiveGroupMode() === ZaloAccount::GROUP_MODE_OFF) {
            throw new ChatUnavailableException('Chế độ nhóm đang tắt trả lời trong nhóm.');
        }

        if (! $account->allows('proactive') && ! $this->hasIncomingMessage($conversation)) {
            throw new ChatUnavailableException('Chưa có tin đến từ hội thoại này; gửi chủ động đang tắt.');
        }

        $limit = (int) config('services.zalo_bridge.send_per_minute', 10);
        $rateKey = $this->rateKey($account);

        if (RateLimiter::tooManyAttempts($rateKey, $limit)) {
            $seconds = RateLimiter::availableIn($rateKey);

            throw new ChatUnavailableException("Đang giới hạn tốc độ gửi để bảo vệ tài khoản. Thử lại sau {$seconds} giây.");
        }

        $this->ensureBridgeRunning($account);

        return $account;
    }

    public function sendAttachment(Conversation $conversation, UploadedFile $file, string $caption, string $clientToken, ?string $staffName): ChatMessage
    {
        throw new ChatUnavailableException('Kênh này chưa hỗ trợ gửi file.');
    }

    public function send(Conversation $conversation, string $body, string $clientToken, ?string $staffName): ChatMessage
    {
        $account = $this->ensureAccountCanSend($conversation);

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

        return $message->wasRecentlyCreated ? $this->deliver($message, $conversation, $account) : $message;
    }

    /**
     * * The status flip is one atomic UPDATE, so a second click while the first attempt runs claims nothing and returns null.
     */
    public function resend(ChatMessage $message): ?ChatMessage
    {
        $conversation = $message->conversation;
        $account = $this->ensureAccountCanSend($conversation);

        $claimed = ChatMessage::query()
            ->whereKey($message->id)
            ->where('direction', ChatMessage::DIRECTION_OUT)
            ->whereIn('send_status', [ChatMessage::STATUS_UNKNOWN, ChatMessage::STATUS_FAILED])
            ->update(['send_status' => ChatMessage::STATUS_SENDING, 'error' => null, 'updated_at' => now()]);

        if ($claimed === 0) {
            return null;
        }

        $message->refresh();

        return $this->deliver($message, $conversation, $account);
    }

    private function hasIncomingMessage(Conversation $conversation): bool
    {
        return ChatMessage::query()
            ->where('conversation_id', $conversation->id)
            ->where('direction', ChatMessage::DIRECTION_IN)
            ->exists();
    }

    /** @throws ChatUnavailableException */
    private function ensureBridgeRunning(ZaloAccount $account): void
    {
        try {
            $state = $this->bridge->health($account->account_key)['state'];
        } catch (ConnectionException|ZaloBridgeException) {
            throw new ChatUnavailableException('Zalo bridge không chạy.');
        }

        if ($state !== 'running') {
            throw new ChatUnavailableException('Zalo bridge chưa đăng nhập hoặc đang kết nối lại, thử lại sau.');
        }
    }

    private function rateKey(ZaloAccount $account): string
    {
        return self::RATE_LIMIT_KEY.':'.$account->id;
    }

    private function deliver(ChatMessage $message, Conversation $conversation, ZaloAccount $account): ChatMessage
    {
        // * Counted when the sidecar is actually called, whatever the outcome.
        RateLimiter::hit($this->rateKey($account), self::RATE_WINDOW_SECONDS);

        try {
            $externalId = $this->bridge->send(
                $account->account_key,
                $conversation->external_chat_id,
                $conversation->type === Conversation::TYPE_GROUP ? 'group' : 'user',
                $message->body,
            );
        } catch (ConnectionException) {
            return $this->settle($message, ChatMessage::STATUS_UNKNOWN, 'Hết thời gian chờ Zalo, tin có thể đã được gửi.');
        } catch (ZaloBridgeException $exception) {
            if ($exception->isAmbiguous()) {
                return $this->settle($message, ChatMessage::STATUS_UNKNOWN, 'Zalo bridge lỗi tạm thời, tin có thể đã được gửi.');
            }

            if ($exception->errorCode === 'not_logged_in') {
                $this->channel->markAccountState($account, 'session_lost');

                return $this->settle($message, ChatMessage::STATUS_FAILED, ZaloChannel::ERROR_MESSAGES['session_lost']);
            }

            return $this->settle($message, ChatMessage::STATUS_FAILED, 'Zalo từ chối tin nhắn này, tin chưa được gửi.');
        }

        $message->forceFill([
            'send_status' => ChatMessage::STATUS_SENT,
            'error' => null,
            'external_message_id' => $externalId,
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
