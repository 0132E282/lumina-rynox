// Pure Facebook helpers (no browser, no I/O): request-template capture/replay and reply classification.
import { firstMatch, isPlainObject } from '../shared/util.mjs';
import {
    hasPlaceholders,
    hasUnsafeField,
    isNonEmptyContainer,
    renderPlaceholders,
    templatizeStrings,
} from '../shared/template.mjs';
import { FACEBOOK } from './selectors.mjs';

function isUnsafeEntry(key, item) {
    return FACEBOOK.unsafeVariableKeys.test(key) && isNonEmptyContainer(item);
}

/**
 * Turns the composer's real request into a template: the typed text, the audience state, the account id and UUID-like ids
 * (client mutation/composer session ids, found by shape) become placeholders; token params are dropped. Returns null when the
 * text or audience cannot be found by value, or the request carries attachments/mention ranges (not safe to replay with other text).
 * @param {string} postData URL-encoded body of the composer's request
 * @param {{text: string, audience: string, userId: string | null}} context
 */
export function buildTemplate(postData, { text, audience, userId }) {
    const params = new URLSearchParams(postData);
    let variables;
    try {
        variables = JSON.parse(params.get('variables') ?? '');
    } catch {
        return null;
    }
    if (
        !isPlainObject(variables) ||
        !FACEBOOK.docIdPattern.test(params.get('doc_id') ?? '') ||
        hasUnsafeField(variables, isUnsafeEntry)
    ) {
        return null;
    }

    const privacy = FACEBOOK.apiPrivacy[audience];
    const found = { text: 0, privacy: 0 };
    const templated = templatizeStrings(
        variables,
        [
            (value) => {
                if (value !== text) {
                    return null;
                }
                found.text += 1;
                return '{{text}}';
            },
            (value) => {
                if (value !== privacy) {
                    return null;
                }
                found.privacy += 1;
                return '{{privacy}}';
            },
            (value) => (userId && value === userId ? '{{user}}' : null),
        ],
        FACEBOOK.uuidPattern,
    );
    // ! Without both anchors a replay could post the wrong text or audience, so no template at all.
    if (found.text === 0 || found.privacy === 0) {
        return null;
    }

    const volatile = new Set(FACEBOOK.volatileParams);
    const kept = {};
    for (const [key, value] of params) {
        if (!volatile.has(key)) {
            kept[key] = value;
        }
    }
    return { params: kept, variables: templated };
}

/** True only for a complete template; anything doubtful is "no template" (the UI path then runs). */
export function isUsableTemplate(template) {
    return (
        isPlainObject(template) &&
        isPlainObject(template.params) &&
        isPlainObject(template.variables) &&
        Object.values(template.params).every(
            (value) => typeof value === 'string',
        ) &&
        FACEBOOK.docIdPattern.test(template.params.doc_id ?? '') &&
        hasPlaceholders(template.variables, ['{{text}}', '{{privacy}}'])
    );
}

/**
 * Fills the template for one post. Tokens are re-read from the live page each time, never taken from the template.
 * @returns {URLSearchParams}
 */
export function renderTemplate(template, input, tokens) {
    const variables = renderPlaceholders(template.variables, {
        '{{text}}': input.text,
        '{{privacy}}': FACEBOOK.apiPrivacy[input.audience] ?? 'SELF',
        '{{user}}': tokens.userId,
    });

    const body = new URLSearchParams(template.params);
    body.set('av', tokens.userId);
    body.set('__user', tokens.userId);
    body.set('fb_dtsg', tokens.dtsg);
    body.set('lsd', tokens.lsd);
    body.set('jazoest', tokens.jazoest);
    body.set('variables', JSON.stringify(variables));
    return body;
}

/**
 * Extracts the page tokens from the logged-in page HTML. Returns null when the page did not expose them.
 * @param {string} html
 * @param {string | undefined} userId value of the login cookie
 */
export function extractTokens(html, userId) {
    const dtsg = firstMatch(html, FACEBOOK.dtsgPatterns);
    const lsd = firstMatch(html, FACEBOOK.lsdPatterns);
    if (!userId || !dtsg || !lsd) {
        return null;
    }
    const jazoest =
        firstMatch(html, [FACEBOOK.jazoestPattern]) ??
        `2${[...dtsg].reduce((sum, character) => sum + character.charCodeAt(0), 0)}`;
    return { userId, dtsg, lsd, jazoest };
}

export function findPostId(value) {
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findPostId(item);
            if (found !== null) {
                return found;
            }
        }
        return null;
    }
    if (!isPlainObject(value)) {
        return null;
    }
    for (const [key, item] of Object.entries(value)) {
        if (
            FACEBOOK.postIdKeys.includes(key) &&
            typeof item === 'string' &&
            FACEBOOK.postIdPattern.test(item)
        ) {
            return item;
        }
        const found = findPostId(item);
        if (found !== null) {
            return found;
        }
    }
    return null;
}

/**
 * 'ok' (post id found), 'rejected' (provably not posted: 4xx, or only `errors` without data) or 'unknown' (may have posted).
 * @returns {{kind: 'ok', postId: string} | {kind: 'rejected'} | {kind: 'unknown'}}
 */
export function classifyApiReply(status, text) {
    if (status >= 500) {
        return { kind: 'unknown' };
    }
    if (status !== 200) {
        return { kind: 'rejected' };
    }

    const lines = text
        .replace(/^\s*for \(;;\);/, '')
        .split(/\r?\n/)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(isPlainObject);
    if (lines.length === 0) {
        return { kind: 'unknown' };
    }

    const postId = findPostId(lines);
    if (postId !== null) {
        return { kind: 'ok', postId };
    }
    if (lines.some((line) => isPlainObject(line.data))) {
        return { kind: 'unknown' };
    }
    return lines.some((line) => line.errors)
        ? { kind: 'rejected' }
        : { kind: 'unknown' };
}

/** Text of the audience button without its "Post audience" prefix. */
export function audienceLabel(text) {
    return text.replace(FACEBOOK.audienceButtonPrefix, '').trim();
}

/** Strips a post link down to facebook.com + path + the known post-id params; null for any other host. */
export function cleanPostUrl(href) {
    try {
        const url = new URL(href, FACEBOOK.homeUrl);
        if (!/(^|\.)facebook\.com$/.test(url.hostname)) {
            return null;
        }
        const clean = new URL(url.pathname, 'https://www.facebook.com');
        for (const name of FACEBOOK.postUrlParams) {
            if (url.searchParams.has(name)) {
                clean.searchParams.set(name, url.searchParams.get(name));
            }
        }
        return clean.toString();
    } catch {
        return null;
    }
}
