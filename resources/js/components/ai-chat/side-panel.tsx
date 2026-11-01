import { useEffect, useState } from 'react';
import type { KeyboardEventHandler, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

/**
 * Right-hand panel whose WIDTH animates (about 200ms, ease-out), so the chat column beside it reflows smoothly instead of jumping when the panel appears or goes.
 * The content keeps its own fixed width and is clipped while the outer width grows, so it never re-wraps during the animation.
 * Motion only without `prefers-reduced-motion`; `dragging` switches the transition off so a drag-resize follows the pointer exactly.
 */
export function SidePanel({
    open,
    width,
    dragging = false,
    label,
    maxWidthClass,
    panelRef,
    onKeyDown,
    children,
}: {
    /** Target state: false collapses to zero width (the parent unmounts later, or keeps it hidden). */
    open: boolean;
    /** Width in px when open. */
    width: number;
    dragging?: boolean;
    label: string;
    /** Tailwind max-width of the panel, relative to the row (keeps a usable chat column). */
    maxWidthClass: string;
    panelRef?: Ref<HTMLElement>;
    onKeyDown?: KeyboardEventHandler<HTMLElement>;
    children: ReactNode;
}) {
    // * Mounts collapsed, then opens on the next frame so the first paint can transition.
    const [shown, setShown] = useState(false);

    useEffect(() => {
        const frame = requestAnimationFrame(() => setShown(open));

        return () => cancelAnimationFrame(frame);
    }, [open]);

    const visible = open && shown;

    return (
        <aside
            ref={panelRef}
            tabIndex={-1}
            aria-label={label}
            aria-hidden={!open || undefined}
            inert={!open}
            onKeyDown={onKeyDown}
            style={{ width: visible ? width : 0 }}
            className={cn(
                'relative min-h-0 shrink-0 overflow-hidden outline-none',
                maxWidthClass,
                visible && 'border-l',
                !dragging &&
                    'motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out',
            )}
        >
            <div
                style={{ width }}
                className={cn(
                    'flex h-full min-h-0 flex-col',
                    !dragging &&
                        'motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out',
                    visible ? 'opacity-100' : 'opacity-0',
                )}
            >
                {children}
            </div>
        </aside>
    );
}
