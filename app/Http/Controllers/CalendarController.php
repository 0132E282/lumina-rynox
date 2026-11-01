<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Event;
use App\Models\Post;
use App\Models\PostTarget;
use App\Support\EventSchedule;
use App\Support\PersonalClock;
use App\Support\ResourcePermission;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

/**
 * * Month calendar page and the same-day conflict check; event CRUD itself goes through the generic items API.
 *
 * @phpstan-type Occurrence array{id: int, title: string, type: string, repeat: string, location: string|null, date: string, starts_at: string, ends_at: string}
 * @phpstan-type CalendarPost array{id: int, title: string, status: string, status_label: string, date: string, time: string, targets: list<array{provider: string, status: string, status_label: string}>}
 */
class CalendarController extends Controller
{
    private const UPCOMING_LIMIT = 5;

    // * How far ahead "Sắp tới" looks for the next events.
    private const UPCOMING_DAYS = 90;

    // * Length of the body excerpt used as a post's title when it has none.
    private const POST_TITLE_FALLBACK_LENGTH = 60;

    public function index(Request $request): Response
    {
        $validated = $request->validate(['month' => ['nullable', 'date_format:Y-m']]);
        $today = PersonalClock::today();
        $month = isset($validated['month'])
            ? CarbonImmutable::createFromFormat('Y-m-d', $validated['month'].'-01', config('cms.personal_timezone'))->startOfDay()
            : $today->startOfMonth();

        // * The grid is whole Monday-first weeks, so it also shows the neighbouring months' days.
        $gridStart = $month->startOfWeek(CarbonImmutable::MONDAY);
        $gridEnd = $month->endOfMonth()->startOfDay()->endOfWeek(CarbonImmutable::SUNDAY)->startOfDay();

        $canViewPosts = ResourcePermission::allows($request->user(), 'posts', 'view');

        return Inertia::render('calendar/index', [
            'month' => $month->format('Y-m'),
            'today' => $today->toDateString(),
            'gridStart' => $gridStart->toDateString(),
            'gridEnd' => $gridEnd->toDateString(),
            'events' => $this->occurrences($this->candidates($gridStart, $gridEnd), $gridStart, $gridEnd)->values(),
            'posts' => $canViewPosts ? $this->posts($gridStart, $gridEnd) : [],
            'upcoming' => $this->upcoming($today),
            'canViewPosts' => $canViewPosts,
            'canCreate' => ResourcePermission::allows($request->user(), 'events', 'create'),
        ]);
    }

    /** * Events on `date` (other than `exclude`), flagged when they overlap `starts_at`-`ends_at`; warns only, never blocks. */
    public function conflicts(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'date' => ['required', 'date_format:Y-m-d'],
            'starts_at' => ['required', 'date_format:H:i'],
            'ends_at' => ['required', 'date_format:H:i'],
            'exclude' => ['nullable', 'integer'],
        ]);
        $day = CarbonImmutable::parse($validated['date'], config('cms.personal_timezone'));
        $newStart = $validated['starts_at'];
        $newEnd = $validated['ends_at'];

        $sameDay = $this->occurrences(
            $this->candidates($day, $day)->when(
                isset($validated['exclude']),
                fn (Collection $events) => $events->reject(fn (Event $event) => $event->id === (int) $validated['exclude']),
            ),
            $day,
            $day,
        )->map(fn (array $occurrence) => [
            ...$occurrence,
            // * Times are zero-padded `H:i`, so string comparison orders them correctly.
            'conflict' => $occurrence['starts_at'] < $newEnd && $newStart < $occurrence['ends_at'],
        ])->values();

        return response()->json(['data' => $sameDay]);
    }

    /**
     * Events that can have an occurrence in [$from, $to]: dated in range, or repeating from before `$to`.
     *
     * @return Collection<int, Event>
     */
    private function candidates(CarbonImmutable $from, CarbonImmutable $to): Collection
    {
        return Event::query()
            ->where('date', '<=', $to->toDateString())
            ->where(fn ($query) => $query
                ->where('repeat', '!=', 'none')
                ->orWhere('date', '>=', $from->toDateString()))
            ->get(['id', 'title', 'type', 'date', 'starts_at', 'ends_at', 'repeat', 'location']);
    }

    /**
     * @param  Collection<int, Event>  $events
     * @return Collection<int, Occurrence>
     */
    private function occurrences(Collection $events, CarbonImmutable $from, CarbonImmutable $to): Collection
    {
        return $events
            ->flatMap(fn (Event $event) => array_map(
                fn (string $date) => [
                    'id' => $event->id,
                    'title' => $event->title,
                    'type' => $event->type,
                    'repeat' => $event->repeat,
                    'location' => $event->location,
                    'date' => $date,
                    'starts_at' => (string) $event->starts_at,
                    'ends_at' => (string) $event->ends_at,
                ],
                EventSchedule::occurrenceDates($event, $from, $to),
            ))
            ->sortBy(fn (array $occurrence) => $occurrence['date'].' '.$occurrence['starts_at']);
    }

    /**
     * Posts shown on the grid: on the latest target `published_at` when any target published, else on `scheduled_at`.
     *
     * @return list<CalendarPost>
     */
    private function posts(CarbonImmutable $gridStart, CarbonImmutable $gridEnd): array
    {
        $timezone = config('cms.personal_timezone');
        // * Timestamps are stored in UTC; the grid days are whole days in the personal time zone.
        $from = $gridStart->startOfDay()->utc();
        $to = $gridEnd->endOfDay()->utc();

        return Post::query()
            ->with('targets:id,post_id,provider,status,published_at')
            ->where(fn ($query) => $query
                ->whereBetween('scheduled_at', [$from, $to])
                ->orWhereHas('targets', fn ($targets) => $targets->whereBetween('published_at', [$from, $to])))
            ->get(['id', 'title', 'body', 'status', 'scheduled_at'])
            ->map(function (Post $post) use ($timezone): ?array {
                // * Targets that never published have no `published_at`, so max() skips them.
                $moment = ($post->targets->max('published_at') ?? $post->scheduled_at)?->setTimezone($timezone);

                return $moment === null ? null : [
                    'id' => $post->id,
                    'title' => $post->title ?? Str::limit(trim($post->body), self::POST_TITLE_FALLBACK_LENGTH),
                    'status' => $post->status,
                    'status_label' => Post::STATUS_LIST[$post->status] ?? $post->status,
                    'date' => $moment->format('Y-m-d'),
                    'time' => $moment->format('H:i'),
                    'targets' => $post->targets->map(fn ($target) => [
                        'provider' => $target->provider,
                        'status' => $target->status,
                        'status_label' => PostTarget::STATUS_LIST[$target->status] ?? $target->status,
                    ])->values()->all(),
                ];
            })
            // * The DB range matches either date, but the day rule picks one: drop posts whose chosen day is off-grid.
            ->filter(fn (?array $item) => $item !== null && $item['date'] >= $gridStart->toDateString() && $item['date'] <= $gridEnd->toDateString())
            ->sortBy(fn (array $item) => $item['date'].' '.$item['time'])
            ->values()
            ->all();
    }

    /** @return array<int, Occurrence> */
    private function upcoming(CarbonImmutable $today): array
    {
        $now = CarbonImmutable::now(config('cms.personal_timezone'));
        $horizon = $today->addDays(self::UPCOMING_DAYS);

        return $this->occurrences($this->candidates($today, $horizon), $today, $horizon)
            ->filter(fn (array $occurrence) => $this->startsAfter($occurrence, $now))
            ->take(self::UPCOMING_LIMIT)
            ->values()
            ->all();
    }

    /** @param Occurrence $occurrence */
    private function startsAfter(array $occurrence, CarbonImmutable $now): bool
    {
        return CarbonImmutable::createFromFormat('Y-m-d H:i', "{$occurrence['date']} {$occurrence['starts_at']}", config('cms.personal_timezone')) > $now;
    }
}
