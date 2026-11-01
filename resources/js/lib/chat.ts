import type { ChatMessage } from '@/types';

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
    ).getTime();
}

/** * `HH:mm` in the browser's time zone. */
export function formatClock(iso: string): string {
    return new Date(iso).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

function dayDifference(iso: string): number {
    return Math.round(
        (startOfDay(new Date()) - startOfDay(new Date(iso))) / DAY_MS,
    );
}

/** * Conversation list time: the clock today, "Hôm qua", otherwise `dd/MM`. */
export function formatListTime(iso: string): string {
    const difference = dayDifference(iso);

    if (difference <= 0) {
        return formatClock(iso);
    }

    if (difference === 1) {
        return 'Hôm qua';
    }

    return new Date(iso).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
    });
}

export function formatDayHeading(iso: string): string {
    const difference = dayDifference(iso);

    if (difference <= 0) {
        return 'Hôm nay';
    }

    return difference === 1 ? 'Hôm qua' : formatDate(iso);
}

export function formatFullDateTime(iso: string): string {
    return `${formatDate(iso)} ${formatClock(iso)}`;
}

export type MessageDayGroup = {
    /** * Local `YYYY-MM-DD`, stable key for the group. */
    key: string;
    heading: string;
    messages: ChatMessage[];
};

/** * Messages are already ordered oldest first; consecutive messages of one local day share a group. */
export function groupByDay(messages: ChatMessage[]): MessageDayGroup[] {
    const groups: MessageDayGroup[] = [];

    for (const message of messages) {
        const reference = message.sent_at ?? new Date().toISOString();
        const date = new Date(reference);
        const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
        const last = groups[groups.length - 1];

        if (last?.key === key) {
            last.messages.push(message);
        } else {
            groups.push({
                key,
                heading: formatDayHeading(reference),
                messages: [message],
            });
        }
    }

    return groups;
}

/** * Merges older pages with the live page by id, oldest first. */
export function mergeMessages(
    older: ChatMessage[],
    latest: ChatMessage[],
): ChatMessage[] {
    const byId = new Map<number, ChatMessage>();

    for (const message of [...older, ...latest]) {
        byId.set(message.id, message);
    }

    return [...byId.values()].sort((first, second) => first.id - second.id);
}
