import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

const KEYBOARD_STEP = 16;

function readWidth(key: string, fallback: number, min: number, max: number) {
    try {
        const stored = Number(localStorage.getItem(key));

        return Number.isFinite(stored) && stored > 0
            ? Math.min(max, Math.max(min, stored))
            : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Width of a side panel that the user drags by its left edge (pointer events, one update per frame)
 * or resizes with the arrow keys. The width is a display preference kept in localStorage.
 */
export function useResizableWidth(
    storageKey: string,
    initial: number,
    min: number,
    max: number,
) {
    const [width, setWidth] = useState(() =>
        readWidth(storageKey, initial, min, max),
    );
    const drag = useRef<{ startX: number; startWidth: number } | null>(null);
    const frame = useRef<number | undefined>(undefined);
    const latest = useRef(width);

    useEffect(() => {
        latest.current = width;
    }, [width]);

    useEffect(() => () => cancelAnimationFrame(frame.current ?? 0), []);

    const clamp = useCallback(
        (value: number) => Math.min(max, Math.max(min, value)),
        [min, max],
    );

    const save = useCallback(() => {
        try {
            localStorage.setItem(
                storageKey,
                String(Math.round(latest.current)),
            );
        } catch {
            // * Storage blocked: the width still applies for this visit.
        }
    }, [storageKey]);

    const onPointerDown = (event: PointerEvent<HTMLElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: latest.current };
        // * No text selection while dragging.
        document.body.style.userSelect = 'none';
    };

    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        const current = drag.current;

        if (current === null) {
            return;
        }

        // * The handle is on the panel's left edge: dragging left makes it wider.
        const next = clamp(
            current.startWidth + (current.startX - event.clientX),
        );

        cancelAnimationFrame(frame.current ?? 0);
        frame.current = requestAnimationFrame(() => setWidth(next));
    };

    const endDrag = () => {
        if (drag.current === null) {
            return;
        }

        drag.current = null;
        document.body.style.userSelect = '';
        save();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        const delta =
            event.key === 'ArrowLeft'
                ? KEYBOARD_STEP
                : event.key === 'ArrowRight'
                  ? -KEYBOARD_STEP
                  : 0;

        if (delta === 0) {
            return;
        }

        event.preventDefault();
        const next = clamp(latest.current + delta);

        latest.current = next;
        setWidth(next);
        save();
    };

    // * Narrows the panel to `limit` when it is wider (not saved: it is a one-off, e.g. to make room for the chat).
    const shrinkTo = useCallback(
        (limit: number) => {
            const next = clamp(Math.min(latest.current, limit));

            latest.current = next;
            setWidth(next);
        },
        [clamp],
    );

    return {
        width,
        shrinkTo,
        handleProps: {
            role: 'separator' as const,
            'aria-orientation': 'vertical' as const,
            'aria-valuenow': Math.round(width),
            'aria-valuemin': min,
            'aria-valuemax': max,
            tabIndex: 0,
            onPointerDown,
            onPointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onKeyDown,
        },
    };
}
