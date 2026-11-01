import { router } from '@inertiajs/react';
import { useCallback, useEffect, useRef } from 'react';
import { useChatRealtime } from '@/hooks/use-chat-realtime';
import type { RealtimeStatus } from '@/hooks/use-chat-realtime';

// * Realtime not configured: keep the old 5s poll. Configured but not connected: slow poll as a safety net.
const POLL_DISABLED_MS = 5000;
const POLL_FALLBACK_MS = 30000;
// * Mail has no realtime signal: `mail:sync` runs once a minute on the server.
const POLL_MAIL_MS = 60000;
// * Signals arriving close together collapse into one reload.
const SIGNAL_DEBOUNCE_MS = 300;

type LiveReloadOptions = {
    /** * Props a partial reload refreshes. */
    only: string[];
    /** * Chat is visible: listen to the realtime signal (or poll in its place). */
    chat?: boolean;
    /** * Mail is visible: poll for it (it never gets a realtime signal). */
    mail?: boolean;
};

/**
 * * Keeps a chat/inbox page fresh. Realtime signals only say "something changed"; the data always comes from a partial reload.
 * * A signal that arrives while the tab is hidden or a send is running is kept and applied afterwards. `setSending` reports a running send.
 */
export function useLiveReload({
    only,
    chat = true,
    mail = false,
}: LiveReloadOptions): {
    status: RealtimeStatus;
    setSending: (sending: boolean) => void;
} {
    const onlyRef = useRef(only);
    onlyRef.current = only;
    const dirtyRef = useRef(false);
    const sendingRef = useRef(false);
    const debounceRef = useRef<number | null>(null);

    const reloadLive = useCallback(() => {
        dirtyRef.current = false;
        router.reload({ only: onlyRef.current });
    }, []);

    const scheduleReload = useCallback(() => {
        if (document.hidden || sendingRef.current) {
            dirtyRef.current = true;

            return;
        }

        if (debounceRef.current !== null) {
            window.clearTimeout(debounceRef.current);
        }

        debounceRef.current = window.setTimeout(() => {
            debounceRef.current = null;

            if (document.hidden || sendingRef.current) {
                dirtyRef.current = true;

                return;
            }

            reloadLive();
        }, SIGNAL_DEBOUNCE_MS);
    }, [reloadLive]);

    const status = useChatRealtime(scheduleReload, chat);

    let pollInterval: number | null;

    if (!chat) {
        pollInterval = mail ? POLL_MAIL_MS : null;
    } else if (status === 'disabled') {
        pollInterval = POLL_DISABLED_MS;
    } else if (status === 'live') {
        pollInterval = mail ? POLL_MAIL_MS : null;
    } else {
        pollInterval = POLL_FALLBACK_MS;
    }

    useEffect(
        () => () => {
            if (debounceRef.current !== null) {
                window.clearTimeout(debounceRef.current);
            }
        },
        [],
    );

    // * Polling: paused while the tab is hidden or a send is running.
    useEffect(() => {
        const refresh = () => {
            if (document.hidden || sendingRef.current) {
                return;
            }

            reloadLive();
        };
        const timer =
            pollInterval === null
                ? null
                : window.setInterval(refresh, pollInterval);

        document.addEventListener('visibilitychange', refresh);

        return () => {
            if (timer !== null) {
                window.clearInterval(timer);
            }

            document.removeEventListener('visibilitychange', refresh);
        };
    }, [pollInterval, reloadLive]);

    // * Reconnected after a drop: reload once to catch up on signals missed while offline.
    const wasLiveRef = useRef(false);
    const previousStatusRef = useRef(status);

    useEffect(() => {
        const previous = previousStatusRef.current;
        previousStatusRef.current = status;

        if (status !== 'live') {
            return;
        }

        if (wasLiveRef.current && previous !== 'live') {
            scheduleReload();
        }

        wasLiveRef.current = true;
    }, [status, scheduleReload]);

    // * A signal deferred by a running send is applied once the send finishes.
    const setSending = useCallback(
        (sending: boolean) => {
            sendingRef.current = sending;

            if (!sending && dirtyRef.current && !document.hidden) {
                reloadLive();
            }
        },
        [reloadLive],
    );

    return { status, setSending };
}
