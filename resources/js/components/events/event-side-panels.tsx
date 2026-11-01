import { Check, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useFormRecordId } from '@/components/form/collection-context';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { EVENT_TYPES } from '@/lib/event-types';
import { formatDate } from '@/lib/personal-date';
import { cn } from '@/lib/utils';
import type { EventConflict, EventRepeat, EventType } from '@/types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const CONFLICT_DEBOUNCE_MS = 400;

const REPEAT_LABELS: Record<EventRepeat, string> = {
    none: 'Không lặp',
    daily: 'Lặp hằng ngày',
    weekly: 'Lặp hằng tuần',
    monthly: 'Lặp hằng tháng',
};

/** * `Thứ Năm, 29/10/2026`; read in UTC so the viewer's time zone cannot shift the day. */
function weekdayDate(iso: string): string {
    const weekday = new Intl.DateTimeFormat('vi-VN', {
        weekday: 'long',
        timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));

    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${formatDate(iso)}`;
}

/** * Live preview of the event being edited and a same-day overlap check; the check only warns, saving is never blocked. */
export function EventSidePanels() {
    const { control } = useFormContext();
    const recordId = useFormRecordId();
    const [title, type, repeat, date, startsAt, endsAt] = useWatch({
        control,
        name: ['title', 'type', 'repeat', 'date', 'starts_at', 'ends_at'],
    }) as [
        string | null,
        EventType | null,
        EventRepeat | null,
        string | null,
        string | null,
        string | null,
    ];
    const [sameDay, setSameDay] = useState<EventConflict[]>([]);

    const validDate = date !== null && DATE_PATTERN.test(date);
    const validTimes =
        startsAt !== null &&
        endsAt !== null &&
        TIME_PATTERN.test(startsAt) &&
        TIME_PATTERN.test(endsAt);
    const endsBeforeStart = validTimes && endsAt < startsAt;
    const checkable = validDate && validTimes && !endsBeforeStart;

    useEffect(() => {
        if (!checkable) {
            return;
        }

        let cancelled = false;
        const timer = window.setTimeout(() => {
            api.get<{ data: EventConflict[] }>('/calendar/conflicts', {
                params: {
                    date,
                    starts_at: startsAt,
                    ends_at: endsAt,
                    exclude: recordId,
                },
            })
                .then((response) => {
                    if (!cancelled) {
                        setSameDay(response.data.data);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setSameDay([]);
                    }
                });
        }, CONFLICT_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [checkable, date, startsAt, endsAt, recordId]);

    const conflicts = checkable ? sameDay.filter((item) => item.conflict) : [];
    const others = checkable ? sameDay.filter((item) => !item.conflict) : [];
    const style = EVENT_TYPES[type ?? 'meeting'] ?? EVENT_TYPES.meeting;

    return (
        <div className="flex w-full min-w-0 flex-col gap-4 md:min-w-72 md:flex-1">
            <Card>
                <CardHeader>
                    <CardTitle>Xem trước trên lịch</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    <p className="text-sm text-muted-foreground">
                        {validDate ? weekdayDate(date) : 'Chưa chọn ngày'}
                        {repeat && repeat !== 'none' && (
                            <span> · {REPEAT_LABELS[repeat]}</span>
                        )}
                    </p>
                    <div
                        className={cn(
                            'rounded-sm border-l-4 px-2 py-1.5 text-sm',
                            style.bar,
                        )}
                    >
                        {validTimes && (
                            <span className="font-semibold">
                                {startsAt}-{endsAt}{' '}
                            </span>
                        )}
                        {title?.trim() || 'Chưa đặt tên'}
                    </div>
                    {endsBeforeStart && (
                        <p className="text-sm text-destructive">
                            Giờ kết thúc phải sau hoặc bằng giờ bắt đầu.
                        </p>
                    )}
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Kiểm tra xung đột</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                        <span>Trùng giờ</span>
                        {conflicts.length > 0 ? (
                            <Badge variant="destructive">
                                <TriangleAlert aria-hidden="true" />
                                {conflicts.length} sự kiện trùng
                            </Badge>
                        ) : (
                            <Badge variant="secondary">
                                <Check aria-hidden="true" />
                                Không trùng
                            </Badge>
                        )}
                    </div>
                    {conflicts.length > 0 && (
                        <ul className="text-sm">
                            {conflicts.map((item) => (
                                <li key={`${item.id}-${item.date}`}>
                                    {item.title} lúc {item.starts_at}-
                                    {item.ends_at}
                                </li>
                            ))}
                        </ul>
                    )}
                    {others.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            Cùng ngày:{' '}
                            {others
                                .map(
                                    (item) =>
                                        `${item.title} lúc ${item.starts_at} không ảnh hưởng`,
                                )
                                .join('; ')}
                            .
                        </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                        Chỉ cảnh báo, vẫn có thể lưu sự kiện.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
