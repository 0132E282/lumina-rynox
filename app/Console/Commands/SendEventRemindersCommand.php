<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Event;
use App\Notifications\EventReminderNotification;
use App\Support\EventSchedule;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

class SendEventRemindersCommand extends Command
{
    protected $signature = 'events:send-reminders';

    protected $description = 'Send in-app reminders for events that reached a "remind before" mark and record them so none repeats';

    public function handle(): int
    {
        $now = CarbonImmutable::now(config('cms.personal_timezone'));
        $today = $now->startOfDay();
        $sent = 0;

        // * Non-repeating events only matter from today up to the furthest mark (1 day) ahead, with a day of slack; repeating ones always do.
        Event::query()
            ->with('admin')
            ->whereNotNull('admin_id')
            ->whereNotNull('remind_before_minutes')
            ->where(fn ($query) => $query
                ->where('repeat', '!=', 'none')
                ->orWhereBetween('date', [$today->toDateString(), $today->addDays(2)->toDateString()]))
            ->chunkById(200, function ($events) use ($now, &$sent) {
                foreach ($events as $event) {
                    $due = EventSchedule::dueReminder($event, $now);

                    // * A trashed or removed admin leaves `admin` null: nobody to notify.
                    if ($due === null || $event->admin === null) {
                        continue;
                    }

                    $event->admin->notify(new EventReminderNotification($event, $due['starts_at'], $due['minutes']));

                    // * Record only the occurrences/marks still relevant, which also prunes keys of past occurrences.
                    $event->forceFill(['reminders_sent' => $this->pruned([...($event->reminders_sent ?? []), ...$due['keys']], $now)])->saveQuietly();
                    $sent++;
                }
            });

        $this->info("Sent {$sent} event reminder(s).");

        return self::SUCCESS;
    }

    /**
     * @param  array<int, string>  $keys
     * @return array<int, string>
     */
    private function pruned(array $keys, CarbonImmutable $now): array
    {
        $cutoff = $now->subDay()->toDateString();

        return array_values(array_unique(array_filter($keys, fn (string $key) => strstr($key, '|', true) >= $cutoff)));
    }
}
