import { relativeTime } from '@/lib/relative-time';
import { cn, formatDateTime } from '@/lib/utils';
import type { AiAccountLimit } from '@/types';

const SCOPE_LABEL = {
    day: 'Đạt limit ngày',
    week: 'Đạt limit tuần',
} as const;

/** * Short text of an account's limit: only what real provider errors stated (the kind and the reset time). `inline` is one line for dense rows. */
function limitText(limit: AiAccountLimit): string {
    return limit.scope ? SCOPE_LABEL[limit.scope] : 'Đạt limit';
}

export function AccountLimit({
    limit,
    inline = false,
}: {
    limit: AiAccountLimit;
    inline?: boolean;
}) {
    if (limit.state !== 'limited') {
        return inline ? null : (
            <span className="text-muted-foreground">Chưa chạm giới hạn</span>
        );
    }

    return (
        <span
            className={cn(
                inline ? 'inline' : 'flex flex-col',
                'text-amber-600 dark:text-amber-400',
            )}
        >
            <span className="font-medium">{limitText(limit)}</span>
            {inline && ' · '}
            <span
                className={inline ? undefined : 'text-xs'}
                title={
                    limit.reset_at ? formatDateTime(limit.reset_at) : undefined
                }
            >
                {limit.reset_at
                    ? `Reset ${relativeTime(limit.reset_at)}`
                    : 'Chưa rõ giờ reset'}
            </span>
        </span>
    );
}
