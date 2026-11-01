import type { PostProviderKey, PostStatus, PostTargetStatus } from './post';

export type TaskStatus = 'todo' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export type Task = {
    id: number;
    title: string;
    description: string | null;
    due_date: string | null;
    priority: TaskPriority;
    status: TaskStatus;
};

export type PersonalModule = 'tasks';

export type TaskDashboardSummary = {
    pending: number;
    overdue: number;
    upcoming: { id: number; title: string }[];
};

export type EventType = 'interview' | 'meeting' | 'reminder';
export type EventRepeat = 'none' | 'daily' | 'weekly' | 'monthly';

/** * One occurrence of an event on a date; a repeating event yields one per day it falls on. */
export type CalendarOccurrence = {
    id: number;
    title: string;
    type: EventType;
    repeat: EventRepeat;
    location: string | null;
    /** * `YYYY-MM-DD` of this occurrence. */
    date: string;
    /** * `HH:mm`. */
    starts_at: string;
    ends_at: string;
};

/** * A social post placed on the calendar by its published (else scheduled) moment. */
export type CalendarPost = {
    id: number;
    title: string;
    status: PostStatus;
    status_label: string;
    /** * `YYYY-MM-DD`. */
    date: string;
    /** * `HH:mm`. */
    time: string;
    targets: {
        provider: PostProviderKey;
        status: PostTargetStatus;
        status_label: string;
    }[];
};

export type EventConflict = CalendarOccurrence & { conflict: boolean };
