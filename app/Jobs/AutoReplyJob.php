<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Ai\AutoReplySwitch;
use App\Services\Chat\ChatChannels;
use App\Services\Chat\Telegram\ChatUnavailableException;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Cache;

/**
 * * Answers ONE inbound customer message when the global switch is on. Queued (needs `php artisan queue:work`) so the sync loops are never held up.
 * * Never retried: a repeat can neither double-send (the `client_token` is derived from the inbound message id) nor spend AI quota twice.
 * ! The chat text only reaches the AI inside the delimited data block of `AiAssistant::suggestReply()`; nothing secret is ever part of the prompt.
 */
final class AutoReplyJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;

    public const TOKEN_PREFIX = 'ai-auto-';

    public int $tries = 1;

    public bool $afterCommit = true;

    public function __construct(public readonly int $messageId) {}

    public function handle(AiAssistant $assistant, ChatChannels $channels, AutoReplySwitch $switch): void
    {
        $message = ChatMessage::query()->with('conversation')->find($this->messageId);

        if ($message === null || ! $switch->enabled() || ! $this->eligible($message)) {
            return;
        }

        // * One run per conversation at a time; a second concurrent run simply gives up.
        Cache::lock('ai-auto-reply:'.$message->conversation_id, 120)->get(fn () => $this->reply($message, $assistant, $channels, $switch));
    }

    private function reply(ChatMessage $message, AiAssistant $assistant, ChatChannels $channels, AutoReplySwitch $switch): void
    {
        $conversation = $message->conversation;

        try {
            if ($this->alreadyHandled($message) || $this->rateLimited($conversation)) {
                return;
            }

            $reply = $assistant->suggestReply($conversation);

            // * The AI call is slow: a person may have answered meanwhile, or the switch may have been turned off.
            if (! $switch->enabled() || $this->staffReplied($message)) {
                return;
            }

            $sent = $channels->sender($conversation->provider)->send($conversation, $reply, self::TOKEN_PREFIX.$message->id, self::staffName());

            if ($sent->send_status === ChatMessage::STATUS_SENT) {
                $switch->recordSuccess();
            } else {
                $switch->recordFailure('Không gửi được tin trả lời tự động.');
            }
        } catch (AiException $exception) {
            $switch->recordFailure($exception->getMessage());
        } catch (ChatUnavailableException) {
            $switch->recordFailure('Kênh chat không gửi được tin trả lời tự động.');
        }
    }

    public static function staffName(): string
    {
        return (string) config('ai.auto_reply.staff_name', 'Trợ lý AI');
    }

    // * Only a fresh private text message from a customer; our own and staff messages (`direction` out) never qualify, so there is no loop.
    private function eligible(ChatMessage $message): bool
    {
        $at = $message->sent_at ?? $message->created_at;

        return $message->direction === ChatMessage::DIRECTION_IN
            && $message->sender_type === ChatMessage::SENDER_CUSTOMER
            && trim($message->body) !== ''
            && $message->conversation->type === Conversation::TYPE_PRIVATE
            && $at !== null
            && $at->greaterThanOrEqualTo(now()->subSeconds((int) config('ai.auto_reply.max_age_seconds', 300)));
    }

    private function alreadyHandled(ChatMessage $message): bool
    {
        $answered = ChatMessage::query()
            ->where('conversation_id', $message->conversation_id)
            ->where('client_token', self::TOKEN_PREFIX.$message->id)
            ->exists();

        return $answered || $this->staffReplied($message);
    }

    private function staffReplied(ChatMessage $message): bool
    {
        return ChatMessage::query()
            ->where('conversation_id', $message->conversation_id)
            ->where('direction', ChatMessage::DIRECTION_OUT)
            ->where('id', '>', $message->id)
            ->exists();
    }

    private function rateLimited(Conversation $conversation): bool
    {
        $automatic = ChatMessage::query()
            ->where('conversation_id', $conversation->id)
            ->where('client_token', 'like', self::TOKEN_PREFIX.'%');

        $interval = (int) config('ai.auto_reply.min_interval_seconds', 30);

        return ($interval > 0 && (clone $automatic)->where('created_at', '>=', now()->subSeconds($interval))->exists())
            || (clone $automatic)->where('created_at', '>=', now()->subHour())->count() >= (int) config('ai.auto_reply.max_per_hour', 10);
    }
}
