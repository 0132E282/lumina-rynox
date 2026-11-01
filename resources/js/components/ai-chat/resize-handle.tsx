import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** * Thin vertical drag bar on a panel's left edge; spread `useResizableWidth().handleProps` onto it. */
export function ResizeHandle({
    label,
    className,
    ...props
}: { label: string } & ComponentProps<'div'>) {
    return (
        <div
            aria-label={label}
            className={cn(
                'absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none transition-colors hover:bg-ring/40 focus-visible:bg-ring/60 focus-visible:outline-none',
                className,
            )}
            {...props}
        />
    );
}
