<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Mailbox;
use App\Services\Mail\MailSync;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

class MailSyncCommand extends Command
{
    protected $signature = 'mail:sync
        {--mailbox= : Only sync the mailbox with this id}
        {--force : Sync even if the mailbox is not due yet}';

    protected $description = 'Sync INBOX and Sent of every due mailbox into the local cache (skips mailboxes whose password was refused)';

    public function handle(MailSync $sync): int
    {
        $query = Mailbox::query()->syncable()->orderBy('id');

        if ($this->option('mailbox') !== null) {
            $query->whereKey((int) $this->option('mailbox'));
        }

        $synced = 0;
        $skipped = 0;
        $failed = 0;
        $new = 0;

        foreach ($query->get() as $mailbox) {
            // * One run per mailbox at a time, also across overlapping scheduler runs and manual `--force` runs.
            $lock = Cache::lock("mail-sync:{$mailbox->id}", 300);

            if (! $lock->get()) {
                $skipped++;

                continue;
            }

            try {
                // * Re-read under the lock: another process may just have synced it or recorded a refused password.
                $mailbox->refresh();

                if (! $mailbox->isSyncable() || (! $this->option('force') && ! $mailbox->isDue())) {
                    $skipped++;

                    continue;
                }

                $new += $sync->syncMailbox($mailbox);
                $synced++;
            } catch (Throwable $exception) {
                // * A bug or an unexpected failure in one mailbox must not stop the others; class name only, never the message.
                Log::error('Mail sync crashed.', ['mailbox_id' => $mailbox->id, 'exception' => $exception::class]);
                $mailbox->forceFill(['status' => Mailbox::STATUS_ERROR, 'last_error' => 'Đồng bộ thất bại.', 'next_sync_at' => now()->addMinutes($mailbox->sync_interval_minutes)])->save();
                $failed++;
            } finally {
                $lock->release();
            }
        }

        // * Counts only: no addresses or subjects in output.
        $this->info("Synced {$synced} mailbox(es), {$new} new message(s), {$skipped} skipped, {$failed} failed.");

        return self::SUCCESS;
    }
}
