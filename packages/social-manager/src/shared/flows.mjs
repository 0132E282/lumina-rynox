import { hasCookie, openPage } from './browser.mjs';
import { StepError } from './errors.mjs';
import { sleep } from './util.mjs';

/** Waits (up to the login deadline) for the human to log in manually; the session cookie's presence is the signal. */
export async function waitForLogin(context, { homeUrl, cookieName, limits }) {
    const page = await openPage(context, homeUrl, limits.stepTimeoutMs);
    const deadline = Date.now() + limits.loginDeadlineMs;

    while (Date.now() < deadline) {
        if (await hasCookie(context, homeUrl, cookieName)) {
            await sleep(3_000); // * let the browser persist the session into the profile before closing
            return { ok: true, loggedIn: true };
        }
        if (page.isClosed()) {
            throw new StepError('not_logged_in');
        }
        await sleep(limits.loginPollMs);
    }

    throw new StepError('timeout');
}

/** Types the text line by line (Enter between lines) the way a person would. */
export async function typeText(page, textbox, text, limits) {
    try {
        await textbox.click({ timeout: limits.stepTimeoutMs });
        const lines = text.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            if (index > 0) {
                await page.keyboard.press('Enter');
            }
            if (lines[index] !== '') {
                await page.keyboard.type(lines[index], {
                    delay: limits.typingDelayMs,
                });
            }
        }
    } catch {
        throw new StepError('composer_not_found');
    }
}

/**
 * Waits for the first proof that the post is live: the provider's "published" notice, or the post showing up in the feed as
 * "just now" (`fresh`, built from `firstLineSnippet`; null when the text has no usable first line).
 * @returns {Promise<'notice' | 'feed'>}
 */
export async function awaitPublishedProof(notice, fresh, timeoutMs) {
    const proofs = [
        notice
            .waitFor({ state: 'visible', timeout: timeoutMs })
            .then(() => 'notice'),
    ];
    if (fresh !== null) {
        proofs.push(
            fresh
                .waitFor({ state: 'visible', timeout: timeoutMs })
                .then(() => 'feed'),
        );
    }
    return Promise.any(proofs);
}
