<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Models\Setting;
use App\Services\Chat\Matrix\BridgeProvisioningClient;
use App\Services\Chat\Matrix\MatrixClient;
use App\Services\Chat\Matrix\MatrixException;
use App\Services\Chat\Messenger\MessengerChannel;
use App\Services\Chat\Messenger\MessengerInbox;
use Illuminate\Console\Command;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * * Receives Messenger messages with Matrix `/sync`. The position lives in `settings` (`chat.matrix.since`).
 * * Run it under a supervisor (long poll loop) or from the scheduler with `--once` (one call, timeout 0).
 * ! Never print or log a `/sync` body, a room event or a `ConnectionException`/`MatrixException` message (room content, tokens).
 */
class MatrixSyncCommand extends Command
{
    // * Long-poll wait on the homeserver's side; `MatrixClient::sync()` adds its own margin on top.
    private const POLL_TIMEOUT_MS = 25000;

    private const IDLE_SECONDS = 10;

    private const RETRY_SECONDS = 3;

    private const SINCE_KEY = 'chat.matrix.since';

    private const LOCK_KEY = 'chat-matrix-sync';

    private const LOCK_SECONDS = 120;

    // * A8/A9: only re-check the bridge login state every few minutes, not on every tick.
    private const LOGIN_CHECK_INTERVAL_MINUTES = 5;

    protected $signature = 'chat:matrix-sync {--once : Sync once with timeout 0 and exit}';

    protected $description = 'Receive Messenger messages into the chat inbox via Matrix /sync';

    private bool $shouldStop = false;

    public function handle(MessengerChannel $channel, MatrixClient $matrix, BridgeProvisioningClient $bridge, MessengerInbox $inbox): int
    {
        $once = (bool) $this->option('once');

        if (function_exists('pcntl_signal')) {
            $this->trap([SIGINT, SIGTERM], function (): void {
                $this->shouldStop = true;
            });
        }

        do {
            $result = $this->syncOnce($channel, $matrix, $bridge, $inbox, $once);

            if ($once) {
                return $result;
            }
        } while (! $this->shouldStop);

        return self::SUCCESS;
    }

    private function syncOnce(MessengerChannel $channel, MatrixClient $matrix, BridgeProvisioningClient $bridge, MessengerInbox $inbox, bool $once): int
    {
        if (! $channel->configured()) {
            $this->line(MessengerChannel::NOT_CONFIGURED);
            $once || $this->pause(self::IDLE_SECONDS);

            return self::SUCCESS;
        }

        $integration = $channel->connected();

        if ($integration === null) {
            $this->line('Messenger chưa kết nối.');
            $once || $this->pause(self::IDLE_SECONDS);

            return self::SUCCESS;
        }

        $this->maybeCheckLogin($channel, $bridge, $integration);

        $lock = Cache::lock(self::LOCK_KEY, self::LOCK_SECONDS);

        if (! $lock->get()) {
            return self::SUCCESS;
        }

        try {
            return $this->runSync($matrix, $inbox, $channel, $integration, $once);
        } finally {
            $lock->release();
        }
    }

    private function runSync(MatrixClient $matrix, MessengerInbox $inbox, MessengerChannel $channel, Integration $integration, bool $once): int
    {
        $since = Setting::get(self::SINCE_KEY);
        $since = is_string($since) && $since !== '' ? $since : null;
        // * The first batch also carries each room's recent history (the bridge backfill); it is stored without raising unread.
        $filter = ['room' => ['timeline' => ['limit' => 50]]];

        try {
            $sync = $matrix->sync($since, $once ? 0 : self::POLL_TIMEOUT_MS, $filter);
        } catch (ConnectionException) {
            $this->error('Không kết nối được tới Matrix homeserver.');
            $once || $this->pause(self::RETRY_SECONDS);

            return self::FAILURE;
        } catch (MatrixException $exception) {
            if ($exception->isAuthFailure()) {
                $channel->markTokenInvalid($integration);
            }

            $this->error('Matrix trả về lỗi, không đồng bộ được lần này.');
            $once || $this->pause(self::RETRY_SECONDS);

            return self::FAILURE;
        }

        $nextBatch = $sync['next_batch'] ?? null;

        if (! is_string($nextBatch) || $nextBatch === '') {
            $this->error('Matrix trả về phản hồi không hợp lệ.');

            return self::FAILURE;
        }

        $this->joinInvites($matrix, $sync);

        try {
            $outcome = DB::transaction(fn (): array => $inbox->ingest($integration, $sync));
        } catch (Throwable) {
            $this->error('Lỗi khi lưu tin Messenger, giữ nguyên vị trí đồng bộ cũ.');

            return self::FAILURE;
        }

        // * Saved only after the batch committed: a crash before this re-delivers the same batch, and dedup drops the repeats.
        Setting::set(self::SINCE_KEY, $nextBatch);

        if ($outcome['stored'] > 0 || $once) {
            $this->info("Đã nhận {$outcome['stored']} tin mới, {$outcome['conversations']} hội thoại.");
        }

        return self::SUCCESS;
    }

    /** @param array<string, mixed> $sync */
    private function joinInvites(MatrixClient $matrix, array $sync): void
    {
        $invites = is_array($sync['rooms']['invite'] ?? null) ? $sync['rooms']['invite'] : [];
        $botUserId = (string) config('services.mautrix_meta.bot_user_id');
        $ghostPrefix = (string) config('services.mautrix_meta.ghost_prefix', '@meta_');

        foreach ($invites as $roomId => $invite) {
            if (! is_string($roomId) || $roomId === '' || ! is_array($invite)) {
                continue;
            }

            $events = is_array($invite['invite_state']['events'] ?? null) ? $invite['invite_state']['events'] : [];
            $inviter = null;

            foreach ($events as $event) {
                if (is_array($event) && ($event['type'] ?? null) === 'm.room.member' && ($event['content']['membership'] ?? null) === 'invite') {
                    $inviter = $event['sender'] ?? null;
                }
            }

            // * Only an invite from the bridge itself (bot or one of its ghosts) is auto-joined; a stray invite from anyone else is ignored.
            if (! is_string($inviter) || ($inviter !== $botUserId && ! str_starts_with($inviter, $ghostPrefix))) {
                continue;
            }

            try {
                $matrix->join($roomId);
            } catch (ConnectionException|MatrixException) {
                $this->line('Không tham gia được một phòng do bridge mời.');
            }
        }
    }

    private function maybeCheckLogin(MessengerChannel $channel, BridgeProvisioningClient $bridge, Integration $integration): void
    {
        $threshold = now()->subMinutes(self::LOGIN_CHECK_INTERVAL_MINUTES);
        $stale = $channel->accounts($integration)->filter(fn (MessengerAccount $account): bool => $account->bridge_state_at === null || $account->bridge_state_at->lt($threshold));

        if ($stale->isEmpty()) {
            return;
        }

        try {
            $logins = collect($bridge->logins());
        } catch (ConnectionException|MatrixException) {
            // * Best effort: a dead bridge keeps each account's current status until the next check.
            return;
        }

        // * One bridge call covers every account; each is updated from its own login (a login gone from the bridge reads as `null`).
        foreach ($stale as $account) {
            $login = $logins->firstWhere('id', $account->login_id);
            $channel->markAccountState($account, $login['state'] ?? null, $login['name'] ?? null);
        }
    }

    private function pause(int $seconds): void
    {
        for ($waited = 0; $waited < $seconds && ! $this->shouldStop; $waited++) {
            sleep(1);
        }
    }
}
