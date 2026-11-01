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

/** * Removes every cached AI chat entry (called at logout). */
export function clearAiChatCache(): void {
    try {
        Object.keys(sessionStorage)
            .filter((key) => key.startsWith(PREFIX))
            .forEach((key) => sessionStorage.removeItem(key));
    } catch {
        // * Nothing to clear when storage is blocked.
    }
}
