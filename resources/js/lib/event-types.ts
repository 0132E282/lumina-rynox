import type { EventType } from '@/types';

type EventTypeStyle = {
    label: string;
    description: string;
    letter: string;
    /** * Dot colour on the filter chips and type cards. */
    dot: string;
    /** * Tinted bar for an event on the calendar grid and previews. */
    bar: string;
};

export const EVENT_TYPES: Record<EventType, EventTypeStyle> = {
    interview: {
        label: 'Phỏng vấn',
        description: 'Từ đơn ứng tuyển',
        letter: 'P',
        dot: 'bg-purple-500',
        bar: 'border-purple-500 bg-purple-500/10 text-foreground',
    },
    meeting: {
        label: 'Họp',
        description: 'Trực tuyến hoặc trực tiếp',
        letter: 'H',
        dot: 'bg-blue-600',
        bar: 'border-blue-600 bg-blue-600/10 text-foreground',
    },
    reminder: {
        label: 'Nhắc việc',
        description: 'Công việc, hạn nộp',
        letter: 'N',
        dot: 'bg-amber-500',
        bar: 'border-amber-500 bg-amber-500/10 text-foreground',
    },
};

export const EVENT_TYPE_KEYS = Object.keys(EVENT_TYPES) as EventType[];
