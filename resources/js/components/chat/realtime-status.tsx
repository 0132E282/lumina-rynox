import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { RealtimeStatus } from '@/hooks/use-chat-realtime';

const LABELS: Record<
    Exclude<RealtimeStatus, 'disabled'>,
    { text: string; dot: string }
> = {
    live: { text: 'Trực tiếp', dot: 'bg-emerald-500' },
    connecting: {
        text: 'Đang kết nối lại, cập nhật mỗi 30 giây',
        dot: 'bg-amber-500',
    },
    offline: {
        text: 'Không kết nối được realtime, cập nhật mỗi 30 giây',
        dot: 'bg-destructive',
    },
};

/** * Small realtime indicator on top of the conversation list; hidden when realtime is not configured, collapses to a dot on click. */
export function RealtimeStatusIndicator({
    status,
}: {
    status: RealtimeStatus;
}) {
    const [open, setOpen] = useState(true);

    if (status === 'disabled') {
        return null;
    }

    const { text, dot } = LABELS[status];

    return (
        <button
            type="button"
            role="status"
            aria-live="polite"
            aria-expanded={open}
            aria-label={text}
            title={open ? 'Thu gọn' : text}
            onClick={() => setOpen((value) => !value)}
            className="flex w-full items-center gap-2 border-b px-4 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/50"
        >
            <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${dot}`}
            />
            {open ? <span className="min-w-0 flex-1">{text}</span> : null}
            {open ? (
                <ChevronUp aria-hidden="true" className="ml-auto size-3" />
            ) : (
                <ChevronDown aria-hidden="true" className="ml-auto size-3" />
            )}
        </button>
    );
}
