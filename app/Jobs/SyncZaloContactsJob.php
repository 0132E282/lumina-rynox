<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Models\ZaloAccount;
use App\Services\Chat\Telegram\ChatUnavailableException;
use App\Services\Chat\Zalo\ZaloBridgeException;
use App\Services\Chat\Zalo\ZaloContactSync;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Log;

/**
 * * Used with `dispatchAfterResponse()` right after the Zalo sidecar reports one account is running, so no queue worker is needed and the
 * * sidecar's callback is not held up. Best effort and never retried: the "Đồng bộ danh bạ" button covers a failed run.
 */
final class SyncZaloContactsJob
{
    use Dispatchable;

    public function __construct(private readonly int $accountId) {}

    public function handle(ZaloContactSync $sync): void
    {
        $account = ZaloAccount::query()->find($this->accountId);

        if ($account === null) {
            return;
        }

        try {
            $sync->sync($account);
        } catch (ChatUnavailableException|ConnectionException|ZaloBridgeException) {
            // ! Fixed text only: exception messages and contact names must not reach the log.
            Log::warning('Zalo contact sync skipped: sidecar unavailable.');
        }
    }
}
