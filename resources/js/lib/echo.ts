import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { api } from '@/lib/api';

const pusherKey = import.meta.env.VITE_PUSHER_APP_KEY;

/** * Realtime is on only when the build has a Pusher app key; otherwise /chat keeps polling. */
export const realtimeEnabled = Boolean(pusherKey);

let echo: Echo<'pusher'> | null = null;

/** * Lazy Echo instance: only the pages that ask for it (the /chat page) open a Pusher connection. */
export function getEcho(): Echo<'pusher'> {
    echo ??= new Echo({
        broadcaster: 'pusher',
        Pusher,
        key: pusherKey ?? '',
        cluster: import.meta.env.VITE_PUSHER_APP_CLUSTER ?? 'mt1',
        forceTLS: true,
        // * There is no csrf <meta> tag, so private channels are authorized through the shared axios `api` (XSRF header).
        channelAuthorization: {
            customHandler: ({ socketId, channelName }, callback) => {
                api.post('/broadcasting/auth', {
                    socket_id: socketId,
                    channel_name: channelName,
                })
                    .then(({ data }) => callback(null, data))
                    .catch((error: Error) => callback(error, null));
            },
        },
    });

    return echo;
}
