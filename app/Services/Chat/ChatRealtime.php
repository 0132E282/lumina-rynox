<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Events\ChatChanged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Collects chat changes and broadcasts one {@see ChatChanged} per commit. Best effort: a broadcaster failure
 * never reaches the caller (inbound ack, send) and pauses broadcasting for a minute instead of stalling every write.
 */
final class ChatRealtime
{
    public const BACKOFF_KEY = 'chat-realtime:backoff';

    public const BACKOFF_SECONDS = 60;

    /** @var array<string, true> */
    private array $kinds = [];

    /** @var array<string, true> */
    private array $conversationIds = [];

    public function touch(string $kind, ?string $conversationId = null): void
    {
        $this->kinds[$kind] = true;

        if ($conversationId !== null) {
            $this->conversationIds[$conversationId] = true;
        }

        // * Runs now outside a transaction; inside one it runs after commit and is dropped on rollback.
        DB::afterCommit(fn () => $this->flush());
    }

    public function flush(): void
    {
        if ($this->kinds === []) {
            return;
        }

        $kinds = array_keys($this->kinds);
        $conversationIds = array_map('strval', array_keys($this->conversationIds));
        $this->kinds = [];
        $this->conversationIds = [];

        try {
            if (Cache::has(self::BACKOFF_KEY)) {
                return;
            }

            event(new ChatChanged($kinds, $conversationIds));
        } catch (Throwable) {
            // ! Fixed message only: the exception text and payload must not reach the log.
            try {
                Cache::put(self::BACKOFF_KEY, true, self::BACKOFF_SECONDS);
            } catch (Throwable) {
                // * Cache is down too: nothing more to do, the write that triggered this must still succeed.
            }

            Log::warning('Chat realtime broadcast failed.');
        }
    }
}
