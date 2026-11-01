<?php

declare(strict_types=1);

namespace App\Services\Ai;

use DateTimeZone;
use Illuminate\Support\Carbon;

/**
 * What a real quota/limit error says about itself: the kind of limit and when it resets. Nothing else survives: the error text is untrusted,
 * is only matched against strict patterns and is never kept. Anything not understood is null.
 */
final class QuotaLimit
{
    public const SCOPE_DAY = 'day';

    public const SCOPE_WEEK = 'week';

    private const MAX_TEXT = 4000;

    private const MAX_AHEAD_DAYS = 60;

    private const MONTHS = ['jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12];

    private const UNIT_SECONDS = ['d' => 86_400, 'h' => 3_600, 'm' => 60, 's' => 1];

    public function __construct(public readonly ?string $scope = null, public readonly ?Carbon $resetAt = null) {}

    /**
     * @param  string  $text  untrusted error/CLI text (only inspected, never kept)
     * @param  string|null  $retryAfter  a `Retry-After` header value or a `retry_after` field: seconds or an HTTP date
     */
    public static function parse(string $text, ?string $retryAfter = null, ?Carbon $now = null): self
    {
        $now ??= Carbon::now(config('app.timezone'));
        $text = substr($text, 0, self::MAX_TEXT);

        return new self(self::scope($text), self::window(self::resetAt($text, $retryAfter, $now), $now));
    }

    /** Week first: "weekly" limits often also mention a session. */
    private static function scope(string $text): ?string
    {
        return match (true) {
            preg_match('/\b(weekly|7[- ]day|per week|this week|week(?:ly)? limit)\b/i', $text) === 1 => self::SCOPE_WEEK,
            preg_match('/\b(5[- ]?hour|daily|per day|today|hourly|per hour|(?:current )?session (?:limit|usage))\b/i', $text) === 1 => self::SCOPE_DAY,
            default => null,
        };
    }

    private static function resetAt(string $text, ?string $retryAfter, Carbon $now): ?Carbon
    {
        $retryAfter = $retryAfter === null ? null : trim($retryAfter);

        if ($retryAfter !== null && preg_match('/^\d{1,8}$/', $retryAfter) === 1) {
            return $now->copy()->addSeconds((int) $retryAfter);
        }

        if ($retryAfter !== null && preg_match('/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/', $retryAfter) === 1) {
            return Carbon::createFromFormat('D, d M Y H:i:s \G\M\T', $retryAfter, 'UTC') ?: null;
        }

        // * Claude CLI: "usage limit reached|1760000000" (unix seconds).
        if (preg_match('/limit reached\|(\d{10})\b/i', $text, $epoch) === 1) {
            return Carbon::createFromTimestamp((int) $epoch[1], $now->getTimezone());
        }

        if (preg_match('/\b(?:resets?|try again|retry|available again)\b(?:\s+(?:at|on|in|after))?\s+(.{1,70})/is', $text, $anchor) !== 1) {
            return null;
        }

        $tail = $anchor[1];

        return self::relative($tail, $now) ?? self::absolute($tail, $now);
    }

    /** "in 2 hours 30 minutes", "5 days 3 hours 2 minutes". */
    private static function relative(string $tail, Carbon $now): ?Carbon
    {
        if (preg_match('/^((?:\d{1,3}\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,]*(?:and\s+)?){1,4})/i', $tail, $run) !== 1) {
            return null;
        }

        preg_match_all('/(\d{1,3})\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/i', $run[1], $parts, PREG_SET_ORDER);
        $seconds = 0;

        foreach ($parts as [, $amount, $unit]) {
            $seconds += (int) $amount * self::UNIT_SECONDS[strtolower($unit[0])];
        }

        return $seconds > 0 ? $now->copy()->addSeconds($seconds) : null;
    }

    /** "Nov 8th, 2026 3:15 PM", "Nov 8, 3pm", "3pm", "3:30 PM (Europe/Berlin)": clock times mean the next such time. */
    private static function absolute(string $tail, Carbon $now): ?Carbon
    {
        $zone = self::zone($tail) ?? $now->getTimezone();
        $local = $now->copy()->setTimezone($zone);
        $clock = '(\d{1,2})(?::(\d{2}))?\s?(am|pm)';

        if (preg_match('/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?:,?\s+(?:at\s+)?'.$clock.')?/i', $tail, $date) === 1 && isset(self::MONTHS[strtolower($date[1])])) {
            $month = self::MONTHS[strtolower($date[1])];
            $day = (int) $date[2];
            $year = isset($date[3]) && $date[3] !== '' ? (int) $date[3] : $local->year;

            if (! checkdate($month, $day, $year)) {
                return null;
            }

            $moment = self::at($local->copy()->setDate($year, $month, $day), $date, 4);

            if ($moment === null) {
                return null;
            }

            if (($date[3] ?? '') === '' && $moment->lt($local->copy()->subDay())) {
                $moment->addYear();
            }

            return $moment;
        }

        if (preg_match('/^'.$clock.'/i', $tail, $time) === 1) {
            $moment = self::at($local->copy(), [1 => '', 2 => '', 3 => '', 4 => $time[1], 5 => $time[2] ?? '', 6 => $time[3]], 4);

            if ($moment !== null && $moment->lte($local)) {
                $moment->addDay();
            }

            return $moment;
        }

        return null;
    }

    /**
     * @param  array<int|string, string>  $match  groups starting at $hourIndex: hour, minutes, am/pm
     */
    private static function at(Carbon $day, array $match, int $hourIndex): ?Carbon
    {
        $hour = $match[$hourIndex] ?? '';

        if ($hour === '') {
            return $day->startOfDay();
        }

        $hour = (int) $hour;
        $minutes = (int) (($match[$hourIndex + 1] ?? '') ?: 0);
        $meridiem = strtolower($match[$hourIndex + 2] ?? '');

        if ($hour < 1 || $hour > 12 || $minutes > 59 || ! in_array($meridiem, ['am', 'pm'], true)) {
            return null;
        }

        $hour = $hour % 12 + ($meridiem === 'pm' ? 12 : 0);

        return $day->setTime($hour, $minutes);
    }

    /** An explicit "(Europe/Berlin)" after the time, only if it is a real zone name. */
    private static function zone(string $tail): ?DateTimeZone
    {
        if (preg_match('/\(([A-Za-z_]+\/[A-Za-z_\/+-]+)\)/', $tail, $match) !== 1 || ! in_array($match[1], DateTimeZone::listIdentifiers(), true)) {
            return null;
        }

        return new DateTimeZone($match[1]);
    }

    /** A reset that is already long past or absurdly far away was not understood correctly. */
    private static function window(?Carbon $moment, Carbon $now): ?Carbon
    {
        if ($moment === null || $moment->lt($now->copy()->subMinute()) || $moment->gt($now->copy()->addDays(self::MAX_AHEAD_DAYS))) {
            return null;
        }

        return $moment->setTimezone($now->getTimezone());
    }
}
