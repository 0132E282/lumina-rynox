import { randomUUID } from 'node:crypto';
import { isPlainObject, mapStrings } from './util.mjs';

const UUID_PLACEHOLDER = /^\{\{uuid:(\d+)\}\}$/;

/**
 * True when some key flagged by `isUnsafeEntry(key, value)` exists anywhere in the structure. Such a request ties itself to one
 * specific post (media, mentions...) and must never become a replay template.
 */
export function hasUnsafeField(value, isUnsafeEntry) {
    if (Array.isArray(value)) {
        return value.some((item) => hasUnsafeField(item, isUnsafeEntry));
    }
    if (!isPlainObject(value)) {
        return false;
    }
    return Object.entries(value).some(
        ([key, item]) =>
            isUnsafeEntry(key, item) || hasUnsafeField(item, isUnsafeEntry),
    );
}

/** True for a non-empty array/object (the usual "this key carries data" test). */
export function isNonEmptyContainer(item) {
    return Array.isArray(item)
        ? item.length > 0
        : isPlainObject(item) && Object.keys(item).length > 0;
}

/**
 * Turns the strings of a captured request into placeholders. Each rule is `(value) => placeholder | null` and the first non-null
 * answer wins; any string shaped like a UUID that no rule claimed becomes `{{uuid:N}}` (same UUID, same N).
 */
export function templatizeStrings(structure, rules, uuidPattern) {
    const uuids = new Map();
    return mapStrings(structure, (value) => {
        for (const rule of rules) {
            const placeholder = rule(value);
            if (placeholder !== null) {
                return placeholder;
            }
        }
        if (uuidPattern.test(value)) {
            if (!uuids.has(value)) {
                uuids.set(value, uuids.size);
            }
            return `{{uuid:${uuids.get(value)}}}`;
        }
        return value;
    });
}

/**
 * Fills a template: `values` maps a placeholder (`'{{text}}'`) to its string, and every `{{uuid:N}}` gets a FRESH UUID
 * (the same one for the same N), so a replay never reuses the captured client ids.
 */
export function renderPlaceholders(structure, values) {
    const uuids = new Map();
    return mapStrings(structure, (value) => {
        if (Object.hasOwn(values, value)) {
            return values[value];
        }
        const match = UUID_PLACEHOLDER.exec(value);
        if (match === null) {
            return value;
        }
        if (!uuids.has(match[1])) {
            uuids.set(match[1], randomUUID());
        }
        return uuids.get(match[1]);
    });
}

/** True when the serialized structure contains every placeholder as a whole JSON string. */
export function hasPlaceholders(structure, placeholders) {
    const serialized = JSON.stringify(structure);
    return placeholders.every((placeholder) =>
        serialized.includes(`"${placeholder}"`),
    );
}
