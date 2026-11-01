// * Stale-while-revalidate copy of AI chat data. sessionStorage only (private text on a shared computer: gone when the tab closes), keyed by user id, size-capped, and cleared at logout.

const PREFIX = 'ai-chat.cache.';
const MAX_ENTRY_CHARS = 200_000;

const keyFor = (userId: number, name: string) => `${PREFIX}${userId}.${name}`;

export function readAiChatCache<T>(userId: number, name: string): T | null {
    try {
        const raw = sessionStorage.getItem(keyFor(userId, name));

        return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
        return null;
    }
}

export function writeAiChatCache(
    userId: number,
    name: string,
    value: unknown,
): void {
    try {
        const raw = JSON.stringify(value);

        if (raw.length > MAX_ENTRY_CHARS) {
            return;
        }

        sessionStorage.setItem(keyFor(userId, name), raw);
    } catch {
        // * Storage blocked or full: the cache is optional, the page still works.
    }
}

const requests = new Map<string, { at: number; promise: Promise<unknown> }>();

/**
 * Runs `fetcher` at most once per `ttlMs` for the same key and shares one in-flight request, so reopening the Code tab, a repo or the repo picker does not spend the server's per-minute budget.
 * Memory only (gone on reload, cleared at logout); a failed request is not kept, so the next call retries.
 */
export function cachedRequest<T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<T>,
): Promise<T> {
    const hit = requests.get(key);

    if (hit && Date.now() - hit.at < ttlMs) {
        return hit.promise as Promise<T>;
    }

    const promise = fetcher();

    requests.set(key, { at: Date.now(), promise });
    promise.catch(() => {
        if (requests.get(key)?.promise === promise) {
            requests.delete(key);
        }
    });

    return promise;
}

/** * Removes every cached AI chat entry (called at logout). */
export function clearAiChatCache(): void {
    requests.clear();

    try {
        Object.keys(sessionStorage)
            .filter((key) => key.startsWith(PREFIX))
            .forEach((key) => sessionStorage.removeItem(key));
    } catch {
        // * Nothing to clear when storage is blocked.
    }
}
