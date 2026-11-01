import { useEffect, useRef, useState } from 'react';
import { getEcho, realtimeEnabled } from '@/lib/echo';

export type RealtimeStatus = 'disabled' | 'connecting' | 'live' | 'offline';

/** * Listens to the private `chat` channel; `onChange` runs for every "something changed" signal. */
export function useChatRealtime(
    onChange: () => void,
    enabled = true,
): RealtimeStatus {
    const active = enabled && realtimeEnabled;
    const [status, setStatus] = useState<RealtimeStatus>(
        active ? 'connecting' : 'disabled',
    );
    const onChangeRef = useRef(onChange);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        if (!active) {
            return;
        }

        const echo = getEcho();
        const handler = () => onChangeRef.current();
        const channel = echo.private('chat');

        channel.listen('.chat.changed', handler);
        channel.error(() => setStatus('offline'));

        const unsubscribe = echo.connector.onConnectionChange((connection) => {
            setStatus(
                connection === 'connected'
                    ? 'live'
                    : connection === 'failed'
                      ? 'offline'
                      : 'connecting',
            );
        });

        return () => {
            unsubscribe();
            channel.stopListening('.chat.changed', handler);
            echo.leave('chat');
        };
    }, [active]);

    return status;
}
