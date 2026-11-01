/** @param {number} milliseconds */
export function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Applies `transform` to every string value (not key) of a JSON-like structure and returns the new structure. */
export function mapStrings(value, transform) {
    if (typeof value === 'string') {
        return transform(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => mapStrings(item, transform));
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                mapStrings(item, transform),
            ]),
        );
    }
    return value;
}

/** First capture group of the first pattern that matches, or null. */
export function firstMatch(text, patterns) {
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match) {
            return match[1];
        }
    }
    return null;
}

/** First non-empty line of the text, trimmed and cut to `length` (null when there is none). */
export function firstLineSnippet(text, length = 40) {
    return (
        text
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line !== '')
            ?.slice(0, length) ?? null
    );
}
