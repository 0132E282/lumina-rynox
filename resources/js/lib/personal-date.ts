// ! Keep in sync with `cms.personal_timezone` in config/cms.php: the server uses it for task due dates and dashboard summaries.
const PERSONAL_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** * Today as `YYYY-MM-DD` in the personal time zone. */
export function todayIso(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: PERSONAL_TIME_ZONE,
    }).format(new Date());
}

/** * `YYYY-MM-DD` → `dd/mm/yyyy` without a Date round-trip, so no time zone can shift the day. */
export function formatDate(iso: string): string {
    const [year, month, day] = iso.slice(0, 10).split('-');

    return `${day}/${month}/${year}`;
}

/** * ISO instant → `dd/mm/yyyy HH:mm` in the personal time zone, whatever the browser's own zone is. */
export function formatDateTimePersonal(iso: string): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: PERSONAL_TIME_ZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(iso));
    const part = (type: string) =>
        parts.find((entry) => entry.type === type)?.value ?? '';

    return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}
