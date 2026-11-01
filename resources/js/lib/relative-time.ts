const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
];

/** * "5 phút trước" style time from an ISO string. */
export function relativeTime(iso: string, now: number = Date.now()): string {
    const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
    const formatter = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
    const [unit, size] = UNITS.find(
        ([, size]) => Math.abs(seconds) >= size,
    ) ?? ['second' as const, 1];

    return formatter.format(Math.round(seconds / size), unit);
}

const DAY_GROUPS = ['Hôm nay', 'Hôm qua', '7 ngày qua', 'Trước đó'] as const;

/** * Which day bucket an ISO time falls in, by calendar day of the viewer: today, yesterday, the 7 days before, or older. */
export function dayGroup(
    iso: string,
    now: Date = new Date(),
): (typeof DAY_GROUPS)[number] {
    const startOfDay = (date: Date) =>
        new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.round(
        (startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000,
    );

    return days <= 0
        ? DAY_GROUPS[0]
        : days === 1
          ? DAY_GROUPS[1]
          : days <= 7
            ? DAY_GROUPS[2]
            : DAY_GROUPS[3];
}

/** * Splits a newest-first list into day buckets, keeping the order and leaving out the empty ones. */
export function groupByDay<T>(
    items: T[],
    iso: (item: T) => string,
    now: Date = new Date(),
): { label: string; items: T[] }[] {
    const groups = new Map<string, T[]>();

    for (const item of items) {
        const label = dayGroup(iso(item), now);

        groups.set(label, [...(groups.get(label) ?? []), item]);
    }

    return DAY_GROUPS.filter((label) => groups.has(label)).map((label) => ({
        label,
        items: groups.get(label) ?? [],
    }));
}
