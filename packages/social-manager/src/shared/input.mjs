import { StepError } from './errors.mjs';

/**
 * Validates the `post` input at the boundary. Any problem is `invalid_input`; nothing is echoed back.
 * @param {unknown} input `{text, audience?, images?, group_url?}` (`groupUrl` is accepted too)
 * @param {{audienceOptions: Record<string, unknown>, defaultAudience: string, groupPostUrl: RegExp, limits: {textMaxLength: number, imageMaxCount: number}}} rules
 * @returns {{text: string, audience: string, images: string[], groupUrl: string | null}}
 */
export function parsePostInput(input, rules) {
    const text =
        typeof input?.text === 'string'
            ? input.text.replace(/\r\n?/g, '\n').trim()
            : '';
    const audience = input?.audience ?? rules.defaultAudience;

    if (
        text === '' ||
        text.length > rules.limits.textMaxLength ||
        typeof audience !== 'string' ||
        !Object.hasOwn(rules.audienceOptions, audience)
    ) {
        throw new StepError('invalid_input');
    }

    const rawImages = input?.images ?? [];
    if (
        !Array.isArray(rawImages) ||
        rawImages.length > rules.limits.imageMaxCount
    ) {
        throw new StepError('invalid_input');
    }
    const images = rawImages.map((value) => {
        try {
            const url = new URL(value);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                throw new Error('scheme');
            }
            return url.toString();
        } catch {
            throw new StepError('invalid_input');
        }
    });

    return {
        text,
        audience,
        images,
        groupUrl: parseGroupUrl(
            input?.group_url ?? input?.groupUrl,
            rules.groupPostUrl,
        ),
    };
}

// * Optional group page (bulk group posting): only a group page of the provider's own site is accepted, anything else is invalid input.
function parseGroupUrl(value, groupPostUrl) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string' || !groupPostUrl.test(value)) {
        throw new StepError('invalid_input');
    }
    return value;
}

/** True when the post input targets a group (`group_url` as the CLI sends it, or `groupUrl`). */
export function hasGroupUrl(input) {
    return (input?.group_url ?? input?.groupUrl ?? null) !== null;
}
