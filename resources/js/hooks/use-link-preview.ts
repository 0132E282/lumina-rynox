import { useEffect, useState } from 'react';
import ChatLinkPreviewController from '@/actions/App/Http/Controllers/ChatLinkPreviewController';
import { api } from '@/lib/api';

export type LinkPreview = {
    url: string;
    host: string;
    title: string | null;
    description: string | null;
    image: string | null;
};

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;
const DEBOUNCE_MS = 600;

// * Pages already looked up this session (null = nothing to show), so retyping the same address costs no request.
const cache = new Map<string, LinkPreview | null>();

/**
 * Card for the first web address in `text`. It waits for typing to pause, asks the server once per address and
 * stays empty when the page offers nothing. `dismiss` hides the card for that address only.
 */
export function useLinkPreview(text: string, enabled: boolean) {
    const url = enabled ? (text.match(URL_PATTERN)?.[0] ?? null) : null;
    const [preview, setPreview] = useState<LinkPreview | null>(null);
    const [dismissed, setDismissed] = useState<string | null>(null);

    useEffect(() => {
        if (url === null) {
            setPreview(null);

            return;
        }

        if (cache.has(url)) {
            setPreview(cache.get(url) ?? null);

            return;
        }

        let cancelled = false;
        const timer = window.setTimeout(() => {
            api.post<{ preview: LinkPreview | null }>(
                ChatLinkPreviewController.url(),
                { url },
            )
                .then((response) => {
                    cache.set(url, response.data.preview);

                    if (!cancelled) {
                        setPreview(response.data.preview);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setPreview(null);
                    }
                });
        }, DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [url]);

    return {
        preview: url !== null && url !== dismissed ? preview : null,
        dismiss: () => setDismissed(url),
    };
}
