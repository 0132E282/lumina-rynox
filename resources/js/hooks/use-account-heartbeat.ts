import { router } from '@inertiajs/react';
import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 60_000;

export function useAccountHeartbeat(): void {
    useEffect(() => {
        const check = async () => {
            try {
                const response = await fetch('/account/status', {
                    headers: { Accept: 'application/json' },
                    credentials: 'same-origin',
                });

                if (response.status === 423 || response.status === 401) {
                    router.visit('/login', { replace: true });
                }
            } catch {
                // * Network hiccup: retry on the next tick.
            }
        };

        const interval = setInterval(check, HEARTBEAT_INTERVAL_MS);

        return () => clearInterval(interval);
    }, []);
}
