<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Models\Mailbox;
use App\Services\Mail\MailSync;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * * Used with `dispatchAfterResponse()` after a mailbox is saved or "Đồng bộ ngay" is pressed, so no queue worker is needed.
 * * Takes the same per-mailbox lock as `mail:sync`; when another run holds it, this one is dropped (that run is syncing already).
 */
final class SyncMailboxJob
{
    use Dispatchable;

    public function __construct(private readonly int $mailboxId) {}

    public function handle(MailSync $sync): void
    {
        $lock = Cache::lock("mail-sync:{$this->mailboxId}", 300);

        if (! $lock->get()) {
            return;
        }

        try {
            $mailbox = Mailbox::query()->find($this->mailboxId);

            if ($mailbox === null || ! $mailbox->isSyncable()) {
                return;
            }

            $sync->syncMailbox($mailbox);
        } catch (Throwable $exception) {
            // * Class name only, never the message (it can hold hosts or addresses).
            Log::error('Mail sync crashed.', ['mailbox_id' => $this->mailboxId, 'exception' => $exception::class]);
            Mailbox::query()->whereKey($this->mailboxId)->update(['status' => Mailbox::STATUS_ERROR, 'last_error' => 'Đồng bộ thất bại.']);
        } finally {
            $lock->release();
        }
    }
}
