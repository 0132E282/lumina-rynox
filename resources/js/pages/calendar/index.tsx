import { Head, Link, router } from '@inertiajs/react';
import { ChevronLeft, ChevronRight, Plus, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useHeaderActions } from '@/contexts/header-actions';
import { EVENT_TYPE_KEYS, EVENT_TYPES } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import type {
    CalendarOccurrence,
    CalendarPost,
    EventType,
    PostStatus,
} from '@/types';

type CalendarProps = {
    /** * Month shown, `YYYY-MM`. */
    month: string;
    /** * Today in the personal time zone, `YYYY-MM-DD`. */
    today: string;
    /** * First (Monday) and last (Sunday) day of the visible grid, `YYYY-MM-DD`. */
    gridStart: string;
    gridEnd: string;
    events: CalendarOccurrence[];
    posts: CalendarPost[];
    upcoming: CalendarOccurrence[];
    canCreate: boolean;
    canViewPosts: boolean;
};

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MAX_EVENTS_PER_DAY = 3;
const DAY_MS = 86_400_000;

/** * Post bar colours by publish outcome: green = published, destructive = failed/missed/partial, otherwise neutral. */
const POST_STATUS_STYLES: Record<PostStatus, string> = {
    published: 'border-chart-2 bg-chart-2/10',
    failed: 'border-destructive bg-destructive/10',
    missed: 'border-destructive bg-destructive/10',
    partial: 'border-destructive bg-destructive/10',
    publishing: 'border-primary bg-primary/10',
    scheduled: 'border-primary bg-primary/10',
    draft: 'border-muted-foreground bg-muted',
};

/** * Dates are plain `YYYY-MM-DD` strings and are stepped in UTC, so no time zone can shift a day. */
function addDays(iso: string, days: number): string {
    return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS)
        .toISOString()
        .slice(0, 10);
}

function dayRange(from: string, to: string): string[] {
    const count = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

    return Array.from({ length: count }, (_, index) => addDays(from, index));
}

function shiftMonth(month: string, delta: number): string {
    const [year, monthNumber] = month.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));

    return shifted.toISOString().slice(0, 7);
}

function dayLabel(iso: string, month: string): string {
    const [, monthNumber, day] = iso.split('-').map(Number);

    // * The 1st of a month and days outside the shown month carry their month, e.g. `1/10`, like the mockup.
    return iso.startsWith(month) && day !== 1
        ? String(day)
        : `${day}/${monthNumber}`;
}

function upcomingWhen(item: CalendarOccurrence, today: string): string {
    const [, month, day] = item.date.split('-');
    const when =
        item.date === today
            ? 'Hôm nay'
            : item.date === addDays(today, 1)
              ? 'Ngày mai'
              : null;
    const parts = [
        `${Number(day)}/${Number(month)} ${item.starts_at}`,
        when,
        item.location,
    ];

    return parts.filter(Boolean).join(' · ');
}

function postTitle(post: CalendarPost): string {
    const providers = post.targets.map((target) => target.provider).join(', ');

    return [`${post.time} ${post.title}`, post.status_label, providers]
        .filter(Boolean)
        .join(' · ');
}

export default function CalendarIndex({
    month,
    today,
    gridStart,
    gridEnd,
    events,
    posts,
    upcoming,
    canCreate,
    canViewPosts,
}: CalendarProps) {
    const [activeTypes, setActiveTypes] = useState<Set<EventType>>(
        () => new Set(EVENT_TYPE_KEYS),
    );

    const [showPosts, setShowPosts] = useState(true);

    useHeaderActions(
        canCreate ? (
            <Button asChild size="sm">
                <Link href="/events/create">
                    <Plus className="size-4" />
                    Thêm sự kiện
                </Link>
            </Button>
        ) : null,
        [canCreate],
    );

    const days = useMemo(
        () => dayRange(gridStart, gridEnd),
        [gridStart, gridEnd],
    );
    const eventsByDate = useMemo(() => {
        const grouped = new Map<string, CalendarOccurrence[]>();

        for (const occurrence of events) {
            if (!activeTypes.has(occurrence.type)) {
                continue;
            }

            grouped.set(occurrence.date, [
                ...(grouped.get(occurrence.date) ?? []),
                occurrence,
            ]);
        }

        return grouped;
    }, [events, activeTypes]);

    const postsByDate = useMemo(() => {
        const grouped = new Map<string, CalendarPost[]>();

        for (const post of showPosts ? posts : []) {
            grouped.set(post.date, [...(grouped.get(post.date) ?? []), post]);
        }

        return grouped;
    }, [posts, showPosts]);

    const goToMonth = (target: string) =>
        router.get(
            '/calendar',
            { month: target },
            { preserveScroll: true, preserveState: true },
        );

    const toggleType = (type: EventType) =>
        setActiveTypes((current) => {
            const next = new Set(current);

            if (!next.delete(type)) {
                next.add(type);
            }

            return next;
        });

    const [year, monthNumber] = month.split('-');

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
            <Head title="Lịch" />

            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Tháng trước"
                    onClick={() => goToMonth(shiftMonth(month, -1))}
                >
                    <ChevronLeft className="size-4" />
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => goToMonth(today.slice(0, 7))}
                >
                    Hôm nay
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Tháng sau"
                    onClick={() => goToMonth(shiftMonth(month, 1))}
                >
                    <ChevronRight className="size-4" />
                </Button>
                <h1 className="ml-2 text-lg font-semibold">
                    Tháng {monthNumber}/{year}
                </h1>
            </div>

            <div className="flex flex-wrap gap-2">
                {EVENT_TYPE_KEYS.map((type) => {
                    const active = activeTypes.has(type);

                    return (
                        <button
                            key={type}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleType(type)}
                            className={cn(
                                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                                active
                                    ? 'bg-card'
                                    : 'text-muted-foreground opacity-60',
                            )}
                        >
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'size-2 rounded-full',
                                    EVENT_TYPES[type].dot,
                                )}
                            />
                            {EVENT_TYPES[type].label}
                        </button>
                    );
                })}
                {canViewPosts && (
                    <button
                        type="button"
                        aria-pressed={showPosts}
                        onClick={() => setShowPosts((current) => !current)}
                        className={cn(
                            'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            showPosts
                                ? 'bg-card'
                                : 'text-muted-foreground opacity-60',
                        )}
                    >
                        <Send aria-hidden="true" className="size-3" />
                        Bài đăng
                    </button>
                )}
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="overflow-x-auto rounded-md border bg-card">
                    <div className="grid min-w-[42rem] grid-cols-7">
                        {WEEKDAYS.map((weekday) => (
                            <div
                                key={weekday}
                                className="border-b bg-muted/40 px-2 py-2 text-xs font-medium"
                            >
                                {weekday}
                            </div>
                        ))}
                        {days.map((day) => {
                            const isToday = day === today;
                            const inMonth = day.startsWith(month);
                            const dayEvents = eventsByDate.get(day) ?? [];
                            const dayPosts = postsByDate.get(day) ?? [];
                            // * Events and posts share the per-day cap; events fill it first.
                            const visibleEvents = dayEvents.slice(
                                0,
                                MAX_EVENTS_PER_DAY,
                            );
                            const visiblePosts = dayPosts.slice(
                                0,
                                MAX_EVENTS_PER_DAY - visibleEvents.length,
                            );
                            const hiddenCount =
                                dayEvents.length +
                                dayPosts.length -
                                visibleEvents.length -
                                visiblePosts.length;

                            return (
                                <div
                                    key={day}
                                    className={cn(
                                        'flex min-h-28 flex-col gap-1 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0',
                                        !inMonth && 'bg-muted/30',
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'flex h-6 min-w-6 items-center justify-center self-start rounded-full px-1 text-xs',
                                            isToday
                                                ? 'bg-primary font-semibold text-primary-foreground'
                                                : inMonth
                                                  ? 'font-medium'
                                                  : 'text-muted-foreground',
                                        )}
                                        aria-label={
                                            isToday
                                                ? `Hôm nay, ${day}`
                                                : undefined
                                        }
                                    >
                                        {dayLabel(day, month)}
                                    </span>
                                    {visibleEvents.map((item) => (
                                        <Link
                                            key={`${item.id}-${item.date}`}
                                            href={`/events/${item.id}`}
                                            title={`${item.starts_at} ${item.title}`}
                                            className={cn(
                                                'truncate rounded-sm border-l-[3px] px-1.5 py-0.5 text-[11px] leading-tight',
                                                EVENT_TYPES[item.type].bar,
                                            )}
                                        >
                                            {item.starts_at} {item.title}
                                        </Link>
                                    ))}
                                    {visiblePosts.map((post) => (
                                        <Link
                                            key={`post-${post.id}`}
                                            href={`/posts/${post.id}`}
                                            title={postTitle(post)}
                                            className={cn(
                                                'flex items-center gap-1 truncate rounded-sm border-l-[3px] px-1.5 py-0.5 text-[11px] leading-tight text-foreground',
                                                POST_STATUS_STYLES[post.status],
                                            )}
                                        >
                                            <Send
                                                aria-hidden="true"
                                                className="size-3 shrink-0"
                                            />
                                            <span className="truncate">
                                                {post.time} {post.title}
                                            </span>
                                        </Link>
                                    ))}
                                    {hiddenCount > 0 && (
                                        <span className="px-1 text-[11px] text-muted-foreground">
                                            +{hiddenCount} mục
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <Card className="shadow-none">
                    <CardHeader>
                        <CardTitle>Sắp tới</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        {upcoming.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                                Chưa có sự kiện sắp tới.
                            </p>
                        )}
                        {upcoming.map((item) => (
                            <Link
                                key={`${item.id}-${item.date}`}
                                href={`/events/${item.id}`}
                                className={cn(
                                    'rounded-sm border-l-[3px] bg-transparent px-2 py-0.5',
                                    EVENT_TYPES[item.type].bar.split(' ')[0],
                                )}
                            >
                                <span className="block text-sm font-semibold">
                                    {item.title}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                    {upcomingWhen(item, today)}
                                </span>
                            </Link>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
