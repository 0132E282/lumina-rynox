import { useCallback, useSyncExternalStore } from 'react';

const KEY_PREFIX = 'chat-background:';
const CHANGE_EVENT = 'chat-background-change';

/** * Ready-made backgrounds (CSS `background` values); an uploaded picture is stored as a `url(data:...)` instead. */
export const CHAT_BACKGROUND_PRESETS: { label: string; value: string }[] = [
    { label: 'Xanh nhạt', value: 'linear-gradient(160deg,#dbeafe,#e0e7ff)' },
    { label: 'Hồng đào', value: 'linear-gradient(160deg,#ffe4e6,#fde68a)' },
    { label: 'Xanh lá', value: 'linear-gradient(160deg,#dcfce7,#ccfbf1)' },
    { label: 'Tím', value: 'linear-gradient(160deg,#ede9fe,#fae8ff)' },
    { label: 'Xám đêm', value: 'linear-gradient(160deg,#1e293b,#334155)' },
];

const read = (conversationId: string): string | null => {
    try {
        return window.localStorage.getItem(KEY_PREFIX + conversationId);
    } catch {
        return null;
    }
};

const subscribe = (callback: () => void) => {
    window.addEventListener(CHANGE_EVENT, callback);
    window.addEventListener('storage', callback);

    return () => {
        window.removeEventListener(CHANGE_EVENT, callback);
        window.removeEventListener('storage', callback);
    };
};

/** * Downscales the picked image so it fits in localStorage; it never leaves this browser. */
export function readBackgroundFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();

        image.onload = () => {
            const scale = Math.min(
                1,
                1280 / Math.max(image.width, image.height),
            );
            const canvas = document.createElement('canvas');

            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas
                .getContext('2d')
                ?.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(
                `url(${canvas.toDataURL('image/jpeg', 0.8)}) center / cover`,
            );
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('invalid image'));
        };
        image.src = url;
    });
}

/** * Per-conversation chat background, kept in this browser only and shared by every component that reads it. */
export function useChatBackground(conversationId: string) {
    const background = useSyncExternalStore(
        subscribe,
        () => read(conversationId),
        () => null,
    );

    const setBackground = useCallback(
        (value: string | null): boolean => {
            try {
                if (value === null) {
                    window.localStorage.removeItem(KEY_PREFIX + conversationId);
                } else {
                    window.localStorage.setItem(
                        KEY_PREFIX + conversationId,
                        value,
                    );
                }
            } catch {
                return false;
            }

            window.dispatchEvent(new Event(CHANGE_EVENT));

            return true;
        },
        [conversationId],
    );

    return [background, setBackground] as const;
}
