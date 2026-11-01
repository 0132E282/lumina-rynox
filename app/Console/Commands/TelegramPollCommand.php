<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Integration;
use App\Services\Chat\Telegram\TelegramApiException;
use App\Services\Chat\Telegram\TelegramChannel;
use App\Services\Chat\Telegram\TelegramInbox;
use Illuminate\Console\Command;
use Illuminate\Http\Client\ConnectionException;

/**
 * * Receives Telegram messages with `getUpdates`. The next offset lives in `integrations.meta.telegram_offset`.
 * * Run it under a supervisor (long poll loop) or from the scheduler with `--once` (one call, no waiting).
 * ! Never print or log the token or an exception message from the HTTP client (it contains the request URL).
 */
class TelegramPollCommand extends Command
{
    // * Long-poll wait on Telegram's side; the HTTP timeout adds a margin in `TelegramClient`.
    private const POLL_SECONDS = 25;

    private const IDLE_SECONDS = 10;

    private const RETRY_SECONDS = 3;

    protected $signature = 'chat:telegram-poll {--once : Fetch pending updates once and exit}';

    protected $description = 'Receive Telegram messages into the chat inbox (getUpdates)';

    private bool $shouldStop = false;

    public function handle(TelegramChannel $channel, TelegramInbox $inbox): int
    {
        $once = (bool) $this->option('once');

        if (function_exists('pcntl_signal')) {
            $this->trap([SIGINT, SIGTERM], function (): void {
                $this->shouldStop = true;
            });
        }

        do {
            $result = $this->pollOnce($channel, $inbox, $once);

            if ($once) {
                return $result;
            }
        } while (! $this->shouldStop);

        return self::SUCCESS;
    }

    /** @return int exit code for `--once`; the loop mode ignores it and keeps going */
    private function pollOnce(TelegramChannel $channel, TelegramInbox $inbox, bool $once): int
    {
        $integration = $channel->connected();

        if ($integration === null || ! $channel->allows($integration, 'receive')) {
            $this->line('Telegram chưa kết nối hoặc đã tắt quyền nhận tin.');
            $once || $this->pause(self::IDLE_SECONDS);

            return self::SUCCESS;
        }

        try {
            $updates = $channel->client($integration)->getUpdates($this->offset($integration), $once ? 0 : self::POLL_SECONDS);
        } catch (TelegramApiException $exception) {
            if ($exception->isAuthFailure()) {
                $channel->markAuthFailed($integration);
                $this->error(TelegramChannel::AUTH_ERROR);
            } else {
                // * 409 means a webhook or another poller owns the bot; Telegram's description is safe to show.
                $this->error("Telegram trả về lỗi {$exception->status}: {$exception->getMessage()}");
            }
            $once || $this->pause(self::IDLE_SECONDS);

            return self::FAILURE;
        } catch (ConnectionException) {
            $this->error('Không kết nối được tới Telegram.');
            $once || $this->pause(self::RETRY_SECONDS);

            return self::FAILURE;
        }

        $outcome = $inbox->ingest($integration, $updates);

        // * Acknowledge only after the batch is stored; a crash before this re-delivers it and dedup drops the repeats.
        if ($outcome['nextOffset'] !== null) {
            $integration->refresh();
            $integration->forceFill([
                'meta' => array_merge($integration->meta ?? [], [TelegramChannel::OFFSET_KEY => $outcome['nextOffset']]),
            ])->save();
        }

        if ($outcome['stored'] > 0 || $once) {
            $this->info("Đã nhận {$outcome['stored']} tin mới.");
        }

        return self::SUCCESS;
    }

    private function offset(Integration $integration): int
    {
        $offset = $integration->meta[TelegramChannel::OFFSET_KEY] ?? 0;

        return is_int($offset) ? $offset : 0;
    }

    private function pause(int $seconds): void
    {
        for ($waited = 0; $waited < $seconds && ! $this->shouldStop; $waited++) {
            sleep(1);
        }
    }
}
