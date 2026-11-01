import type { route } from 'ziggy-js';
import type { Auth } from '@/types/auth';

declare global {
    interface Window {
        route: typeof route;
    }
}

declare module 'react' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface InputHTMLAttributes<T> {
        passwordrules?: string;
    }
}

declare module '@inertiajs/core' {
    export interface InertiaConfig {
        sharedPageProps: {
            name: string;
            auth: Auth;
            sidebarOpen: boolean;
            canUseAi: boolean;
            aiAutoReply: { enabled: boolean; last_error: string | null };
            [key: string]: unknown;
        };
    }
}
