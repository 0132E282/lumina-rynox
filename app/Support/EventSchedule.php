<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\Event;
use Carbon\CarbonImmutable;

/**
 * * Pure date maths for events: repeat expansion and due reminders. Wall-clock values are read in `cms.personal_timezone`.
 * * Touches no database, so it can be checked with unsaved `Event` instances.
 */
final class EventSchedule
{
    // * Upper bound on generated occurrences per call, so a daily event over a huge range stays cheap.
    private const MAX_OCCURRENCES = 400;

    /**
     * Occurrence dates (`Y-m-d`) falling in [$from, $to], inclusive. Monthly events clamp to the month's last day.
     *
     * @return array<int, string>
     */
    public static function occurrenceDates(Event $event, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $anchor = self::anchor($event);
        $from = $from->startOfDay();
        $to = $to->startOfDay();

        if ($event->repeat === 'none') {
            return $anchor->betweenIncluded($from, $to) ? [$anchor->toDateString()] : [];
        }

        if ($anchor > $to) {
            return [];
        }

        $dates = [];

        for ($step = self::firstStep($event->repeat, $anchor, $from); count($dates) < self::MAX_OCCURRENCES; $step++) {
            $date = self::nth($event->repeat, $anchor, $step);

            if ($date > $to) {
                break;
            }

            if ($date >= $from) {
                $dates[] = $date->toDateString();
            }
        }

        return $dates;
    }

    public static function startAt(Event $event, string $date): CarbonImmutable
    {
        return self::at($date, (string) $event->starts_at);
    }

    public static function endAt(Event $event, string $date): CarbonImmutable
    {
        return self::at($date, (string) $event->ends_at);
    }

    /**
     * * The reminder to send now for one event, or null. A mark is due once `start - minutes` has passed while the
     * * occurrence has not started, so a missed mark is still delivered late and a past occurrence never is.
     * * Several marks due at once (e.g. event created 10 minutes ahead) send only the closest one, but all are recorded.
     *
     * @return array{date: string, minutes: int, starts_at: CarbonImmutable, keys: array<int, string>}|null
     */
    public static function dueReminder(Event $event, CarbonImmutable $now): ?array
    {
        $marks = collect($event->remind_before_minutes ?? [])->map(fn ($minutes) => (int) $minutes)->unique()->sort()->values();

        if ($marks->isEmpty()) {
            return null;
        }

        $sent = $event->reminders_sent ?? [];
        $today = $now->startOfDay();
        // * An occurrence that already started cannot be reminded, so only today and later can be due; the longest mark bounds how far ahead.
        $horizon = $today->addDays((int) ceil($marks->max() / 1440) + 1);

        foreach (self::occurrenceDates($event, $today, $horizon) as $date) {
            $startsAt = self::startAt($event, $date);

            if ($startsAt <= $now) {
                continue;
            }

            $dueKeys = [];
            $closest = null;

            foreach ($marks as $minutes) {
                $key = "{$date}|{$minutes}";

                if ($startsAt->subMinutes($minutes) <= $now && ! in_array($key, $sent, true)) {
                    $dueKeys[] = $key;
                    $closest ??= $minutes;
                }
            }

            if ($closest !== null) {
                return ['date' => $date, 'minutes' => $closest, 'starts_at' => $startsAt, 'keys' => $dueKeys];
            }
        }

        return null;
    }

    private static function anchor(Event $event): CarbonImmutable
    {
        return CarbonImmutable::parse($event->date->format('Y-m-d'), config('cms.personal_timezone'))->startOfDay();
    }

    private static function at(string $date, string $time): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('Y-m-d H:i', "{$date} ".substr($time, 0, 5), config('cms.personal_timezone'));
    }

    /** * Last step that can still precede `$from`, so iteration starts near the range instead of at the anchor. */
    private static function firstStep(string $repeat, CarbonImmutable $anchor, CarbonImmutable $from): int
    {
        if ($from <= $anchor) {
            return 0;
        }

        $step = match ($repeat) {
            'daily' => $anchor->diffInDays($from),
            'weekly' => intdiv((int) $anchor->diffInDays($from), 7),
            'monthly' => (int) $anchor->diffInMonths($from),
            default => 0,
        };

        return max(0, (int) $step - 1);
    }

    private static function nth(string $repeat, CarbonImmutable $anchor, int $step): CarbonImmutable
    {
        return match ($repeat) {
            'daily' => $anchor->addDays($step),
            'weekly' => $anchor->addWeeks($step),
            default => $anchor->addMonthsNoOverflow($step),
        };
    }
}
