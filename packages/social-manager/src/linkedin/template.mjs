// Pure LinkedIn helpers (no browser, no I/O): request-template capture/replay and reply classification.
import { isPlainObject } from '../shared/util.mjs';
import {
    hasPlaceholders,
    hasUnsafeField,
    isNonEmptyContainer,
    renderPlaceholders,
    templatizeStrings,
} from '../shared/template.mjs';
import { LINKEDIN } from './selectors.mjs';

function isUnsafeEntry(key, item) {
    return (
        LINKEDIN.unsafeVariableKeys.test(key) &&
        (isNonEmptyContainer(item) || (typeof item === 'string' && item !== ''))
    );
}

/**
 * Turns the composer's real request into a template: the typed text, the visibility value and UUID-like ids become placeholders.
 * Returns null when the text or visibility cannot be found by value, or the request carries media/mention/hashtag entities.
 * @param {{url(): string, postData(): string | null, headers(): Record<string, string>}} request
 * @param {{text: string, audience: string}} context
 * @param {object | null} previous Template already saved (its other audiences stay usable when the path is the same).
 */
export function buildTemplate(request, { text, audience }, previous = null) {
    const url = new URL(request.url());
    const apiPath = `${url.pathname}${url.search}`;
    let body;
    try {
        body = JSON.parse(request.postData() ?? '');
    } catch {
        return null;
    }
    const visibilityPattern = LINKEDIN.apiVisibility[audience];
    if (
        !isPlainObject(body) ||
        visibilityPattern === undefined ||
        !LINKEDIN.apiPathPattern.test(apiPath) ||
        hasUnsafeField(body, isUnsafeEntry)
    ) {
        return null;
    }

    const found = { text: 0, visibility: 0 };
    let observed = null;
    const templated = templatizeStrings(
        body,
        [
            (value) => {
                if (value !== text) {
                    return null;
                }
                found.text += 1;
                return '{{text}}';
            },
            (value) => {
                if (!visibilityPattern.test(value)) {
                    return null;
                }
                found.visibility += 1;
                observed = value;
                return '{{visibility}}';
            },
        ],
        LINKEDIN.uuidPattern,
    );
    // ! Without both anchors a replay could post the wrong text or visibility, so no template at all.
    if (found.text === 0 || found.visibility === 0) {
        return null;
    }

    const headers = {};
    for (const [name, value] of Object.entries(request.headers())) {
        if (LINKEDIN.replayHeaders.includes(name.toLowerCase())) {
            headers[name.toLowerCase()] = value;
        }
    }

    // * The audiences already observed for the same request stay usable; a new one is added.
    const visibility = {
        ...(previous?.path === apiPath ? previous.visibility : {}),
        [audience]: observed,
    };
    return { path: apiPath, headers, body: templated, visibility };
}

/** True only for a complete template; anything doubtful is "no template" (the UI path then runs). */
export function isUsableTemplate(template) {
    return (
        isPlainObject(template) &&
        typeof template.path === 'string' &&
        LINKEDIN.apiPathPattern.test(template.path) &&
        isPlainObject(template.headers) &&
        Object.values(template.headers).every(
            (value) => typeof value === 'string',
        ) &&
        isPlainObject(template.body) &&
        isPlainObject(template.visibility) &&
        Object.values(template.visibility).every(
            (value) => typeof value === 'string',
        ) &&
        hasPlaceholders(template.body, ['{{text}}', '{{visibility}}'])
    );
}

/** Fills the template for one post; every `{{uuid:N}}` gets a fresh UUID. */
export function renderBody(template, input) {
    return renderPlaceholders(template.body, {
        '{{text}}': input.text,
        '{{visibility}}': template.visibility[input.audience],
    });
}

export function findPostUrn(value) {
    if (typeof value === 'string') {
        return LINKEDIN.postUrnPattern.exec(value)?.[0] ?? null;
    }
    if (Array.isArray(value) || isPlainObject(value)) {
        for (const item of Object.values(value)) {
            const found = findPostUrn(item);
            if (found !== null) {
                return found;
            }
        }
    }
    return null;
}

/**
 * 'ok' (post urn found), 'rejected' (provably not posted: 4xx, or only `errors` without data) or 'unknown' (may have posted).
 * @param {number} status
 * @param {string} text
 * @param {string | null | undefined} restliId value of the `x-restli-id` response header
 * @returns {{kind: 'ok', postId: string} | {kind: 'rejected'} | {kind: 'unknown'}}
 */
export function classifyApiReply(status, text, restliId) {
    if (status >= 500 || status < 200 || (status >= 300 && status < 400)) {
        return { kind: 'unknown' };
    }
    if (status >= 400) {
        return { kind: 'rejected' };
    }

    const headerUrn = LINKEDIN.postUrnPattern.exec(restliId ?? '')?.[0] ?? null;
    if (headerUrn !== null) {
        return { kind: 'ok', postId: headerUrn };
    }

    let json;
    try {
        json = JSON.parse(text);
    } catch {
        return { kind: 'unknown' };
    }

    const postId = findPostUrn(json);
    if (postId !== null) {
        return { kind: 'ok', postId };
    }
    if (isPlainObject(json) && isPlainObject(json.data)) {
        return { kind: 'unknown' };
    }
    return isPlainObject(json) &&
        Array.isArray(json.errors) &&
        json.errors.length > 0
        ? { kind: 'rejected' }
        : { kind: 'unknown' };
}

export function postUrl(postId) {
    return `https://www.linkedin.com/feed/update/${postId}/`;
}

/** Text of the visibility button without its prefix. */
export function audienceLabel(text) {
    return text.replace(LINKEDIN.audienceButtonPrefix, '').trim();
}

/** True only when the label is the wanted audience and none of the others. */
export function matchesAudience(label, audience) {
    return Object.entries(LINKEDIN.audienceOptions).every(
        ([key, pattern]) => pattern.test(label) === (key === audience),
    );
}

/** Strips a post link down to https://www.linkedin.com + path; null for any other host or path. */
export function cleanPostUrl(href) {
    try {
        const url = new URL(href, LINKEDIN.homeUrl);
        if (
            url.hostname !== 'www.linkedin.com' ||
            !LINKEDIN.postUrlPath.test(url.pathname)
        ) {
            return null;
        }
        return new URL(url.pathname, 'https://www.linkedin.com').toString();
    } catch {
        return null;
    }
}

/** UI-path result from a (possibly missing) post link. */
export function resultFromUrl(url) {
    const clean = url ? cleanPostUrl(url) : null;
    const postId = clean
        ? (LINKEDIN.postUrnPattern.exec(clean)?.[0] ?? null)
        : null;
    return {
        ok: true,
        via: 'ui',
        url: clean ?? undefined,
        post_id: postId ?? undefined,
    };
}
