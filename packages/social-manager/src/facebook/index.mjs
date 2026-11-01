// Facebook provider: posts text (optionally with images, no video) to the user's own timeline by driving a REAL Chrome with a
// dedicated persistent profile. Plain Playwright: no stealth, fingerprint/header/webdriver tweaks, no proxy or captcha tricks.
// A checkpoint/captcha is never bypassed: the operation stops with `checkpoint` and the human solves it.
import os from 'node:os';
import path from 'node:path';
import { hasCookie, isCheckpoint, openPage } from '../shared/browser.mjs';
import { StepError } from '../shared/errors.mjs';
import {
    awaitPublishedProof,
    typeText,
    waitForLogin,
} from '../shared/flows.mjs';
import { scrapeGroups } from '../shared/groups.mjs';
import { hasGroupUrl, parsePostInput } from '../shared/input.mjs';
import { runOperation } from '../shared/runtime.mjs';
import { createSessionStore } from '../shared/session-store.mjs';
import { firstLineSnippet } from '../shared/util.mjs';
import { FACEBOOK, FACEBOOK_LIMITS as LIMITS } from './selectors.mjs';
import {
    audienceLabel,
    buildTemplate,
    classifyApiReply,
    cleanPostUrl,
    extractTokens,
    isUsableTemplate,
    renderTemplate,
} from './template.mjs';

export const FACEBOOK_MODES = ['login', 'check', 'session', 'groups', 'post'];

const SESSION_KEYS = [
    'user_id',
    'fb_dtsg',
    'lsd',
    'jazoest',
    'cookie_header',
    'template',
];

/**
 * @typedef {object} ProviderOptions
 * @property {string} [storageDirectory] Where the profile and session file live (default `~/.social-manager`).
 * @property {string} [profileDirectory] Overrides `<storageDirectory>/facebook-profile`.
 * @property {string} [sessionFile] Overrides `<storageDirectory>/facebook-session.json` (0600, holds live credentials).
 * @property {boolean} [headless] Hide the window. Ignored for `login` (a human must see it).
 */

/**
 * Creates the Facebook client. Every method resolves to ONE JSON-safe result object and never throws: success is `{ok: true, ...}`,
 * failure is `{ok: false, error: <fixed code>}` (see `ERROR_EXIT_CODES`). Results never contain cookies or page content.
 * @param {ProviderOptions} [options]
 */
export function createFacebook(options = {}) {
    const storageDirectory =
        options.storageDirectory ?? path.join(os.homedir(), '.social-manager');
    const profileDirectory =
        options.profileDirectory ??
        path.join(storageDirectory, 'facebook-profile');
    const store = createSessionStore(
        options.sessionFile ??
            path.join(storageDirectory, 'facebook-session.json'),
        SESSION_KEYS,
    );
    const headless = options.headless === true;

    const operation = (settings) =>
        runOperation({
            profileDirectory,
            headless,
            interactive: false,
            deadlineMs: LIMITS.postDeadlineMs,
            tempPrefix: 'facebook-post-',
            limits: LIMITS,
            ...settings,
        });

    const post = (input) =>
        operation({
            prepare: async (workspace) => {
                const parsed = parsePostInput(input, {
                    audienceOptions: FACEBOOK.audienceOptions,
                    groupPostUrl: FACEBOOK.groupPostUrl,
                    defaultAudience: 'self',
                    limits: LIMITS,
                });
                return {
                    input: parsed,
                    files: await workspace.downloadImages(parsed.images),
                };
            },
            run: (context, prepared) =>
                runPost(context, store, prepared.input, prepared.files),
        });

    return {
        /** Human logs in manually in the opened window; resolves once the login cookie exists. */
        login: () =>
            operation({
                interactive: true,
                deadlineMs: LIMITS.loginDeadlineMs + 30_000,
                run: (context) =>
                    waitForLogin(context, {
                        homeUrl: FACEBOOK.homeUrl,
                        cookieName: FACEBOOK.loginSessionCookie,
                        limits: LIMITS,
                    }),
            }),
        /** `{ok: true, loggedIn: boolean}`. */
        check: () =>
            operation({
                reportLoggedOut: true,
                run: (context) => runCheck(context),
            }),
        /** Login check that also refreshes the saved session (cookie header + tokens). */
        session: () =>
            operation({
                reportLoggedOut: true,
                run: (context) => runSession(context, store),
            }),
        /** Read-only: `{ok: true, groups: [{id, name, url}]}` of the groups the account joined. */
        groups: () => operation({ run: (context) => runGroups(context) }),
        /**
         * @param {{text: string, audience?: 'self' | 'friends' | 'public', images?: string[], group_url?: string}} input `images` are
         * http(s) URLs; with `group_url` (a group page) the post goes into that group instead of the timeline.
         * @returns {Promise<{ok: true, via: 'browser-api' | 'ui', post_id?: string, url?: string} | {ok: false, error: string}>}
         */
        post,
        /**
         * Posts into one group page the account joined: `{groupUrl, text, images?}` (`audience` is ignored, a group post is seen
         * by the group). Same result contract as `post`; `groupUrl` is required.
         */
        postToGroup: (input) =>
            hasGroupUrl(input)
                ? post(input)
                : Promise.resolve({ ok: false, error: 'invalid_input' }),
    };
}

async function openHome(context) {
    return openPage(context, FACEBOOK.homeUrl, LIMITS.stepTimeoutMs);
}

function hasSession(context) {
    return hasCookie(context, FACEBOOK.homeUrl, FACEBOOK.loginSessionCookie);
}

async function runCheck(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page, FACEBOOK)) {
        throw new StepError('checkpoint');
    }

    return { ok: true, loggedIn: await hasSession(context) };
}

// * Reads the tokens from the real logged-in page, each time. Returns null (never throws) when the page did not expose them.
async function readPageTokens(context, page) {
    try {
        const cookies = await context.cookies(FACEBOOK.homeUrl);
        const userId = cookies.find(
            (cookie) => cookie.name === FACEBOOK.loginSessionCookie,
        )?.value;
        const tokens = extractTokens(await page.content(), userId);
        if (tokens === null) {
            return null;
        }
        return {
            ...tokens,
            cookieHeader: cookies
                .map((cookie) => `${cookie.name}=${cookie.value}`)
                .join('; '),
        };
    } catch {
        return null;
    }
}

// * Persists the page tokens just read from the live session (best effort: a failure never changes a post outcome).
function saveTokens(store, tokens) {
    if (tokens === null) {
        return;
    }
    try {
        store.write({
            user_id: tokens.userId,
            fb_dtsg: tokens.dtsg,
            lsd: tokens.lsd,
            jazoest: tokens.jazoest,
            cookie_header: tokens.cookieHeader,
        });
    } catch {
        // * A consumer's own HTTP tier then simply has no fresh session and the browser path runs.
    }
}

// * Returns the saved template only when it is complete; anything doubtful is "no template" (the UI path then runs).
function readTemplate(store) {
    const template = store.read().template;
    return isUsableTemplate(template) ? template : null;
}

function discardTemplate(store) {
    try {
        store.write({ template: null });
    } catch {
        // * Failing to drop a stale template only costs one more rejected attempt later.
    }
}

// * Remembers the composer's own GraphQL request (text-only posts) as a replay template. Nothing is sent or altered.
function watchComposerRequest(page, context) {
    const captured = { template: null };
    page.on('request', (request) => {
        try {
            if (
                !context.enabled ||
                request.method() !== 'POST' ||
                !request.url().includes(FACEBOOK.graphqlPath)
            ) {
                return;
            }
            const postData = request.postData() ?? '';
            const name = new URLSearchParams(postData).get(
                'fb_api_req_friendly_name',
            );
            if (FACEBOOK.composerFriendlyName.test(name ?? '')) {
                captured.template =
                    buildTemplate(postData, context) ?? captured.template;
            }
        } catch {
            // * An unreadable request body is simply not the composer request.
        }
    });
    return captured;
}

// * Replays the template with a fetch INSIDE the logged-in page. Returns the result, or null when the request was
// * definitively rejected (the caller may then use the UI once). Anything ambiguous throws `unknown`: no fallback, no retry.
async function postThroughApi(page, template, input, tokens) {
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    const friendlyName = template.params.fb_api_req_friendly_name;
    if (friendlyName) {
        headers['x-fb-friendly-name'] = friendlyName;
    }
    headers['x-fb-lsd'] = tokens.lsd;

    let reply;
    try {
        reply = await page.evaluate(
            async ({ path, body, requestHeaders, timeoutMs }) => {
                const response = await fetch(path, {
                    method: 'POST',
                    credentials: 'include',
                    headers: requestHeaders,
                    body,
                    signal: AbortSignal.timeout(timeoutMs),
                });
                return { status: response.status, text: await response.text() };
            },
            {
                path: FACEBOOK.apiPath,
                body: renderTemplate(template, input, tokens).toString(),
                requestHeaders: headers,
                timeoutMs: LIMITS.apiRequestTimeoutMs,
            },
        );
    } catch {
        // ! Network error, timeout or a navigation while the request was in flight: it may have been delivered.
        throw new StepError('unknown');
    }

    const outcome = classifyApiReply(reply.status, String(reply.text));
    if (outcome.kind === 'rejected') {
        return null;
    }
    if (outcome.kind !== 'ok') {
        throw new StepError('unknown');
    }
    return {
        ok: true,
        via: 'browser-api',
        post_id: outcome.postId,
        url: /^\d+$/.test(outcome.postId)
            ? `https://www.facebook.com/${outcome.postId}`
            : undefined,
    };
}

async function runGroups(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page, FACEBOOK)) {
        throw new StepError('checkpoint');
    }
    if (!(await hasSession(context))) {
        throw new StepError('not_logged_in');
    }

    return scrapeGroups(
        page,
        {
            groupsUrl: FACEBOOK.groupsUrl,
            hostname: 'www.facebook.com',
            groupPath: FACEBOOK.groupPath,
            groupLinkLabel: FACEBOOK.groupLinkLabel,
            groupUrl: (id) => `https://www.facebook.com/groups/${id}/`,
        },
        LIMITS,
    );
}

async function runSession(context, store) {
    const page = await openHome(context);

    if (await isCheckpoint(page, FACEBOOK)) {
        throw new StepError('checkpoint');
    }
    if (!(await hasSession(context))) {
        return { ok: true, loggedIn: false };
    }

    const tokens = await readPageTokens(context, page);
    saveTokens(store, tokens);

    return { ok: true, loggedIn: true, session: tokens !== null };
}

async function openComposer(page) {
    const trigger = page
        .getByRole('button', { name: FACEBOOK.composerTrigger })
        .first();
    try {
        await trigger.click({ timeout: LIMITS.stepTimeoutMs });
        const dialog = page.getByRole('dialog').last();
        const textbox = dialog
            .getByRole('textbox', { name: FACEBOOK.composerTextbox })
            .first();
        await textbox.waitFor({
            state: 'visible',
            timeout: LIMITS.stepTimeoutMs,
        });
        return { dialog, textbox };
    } catch {
        throw new StepError('composer_not_found');
    }
}

// ! Never submit with an audience that was not verified: a public leak is worse than a failed post.
async function setAudience(page, dialog, audience) {
    const wanted = FACEBOOK.audienceOptions[audience];
    const button = dialog
        .getByRole('button', { name: FACEBOOK.audienceButton })
        .first();

    try {
        const current = audienceLabel(
            (await button.innerText({ timeout: LIMITS.stepTimeoutMs })) ?? '',
        );
        if (wanted.test(current)) {
            return;
        }

        await button.click({ timeout: LIMITS.stepTimeoutMs });
        await page
            .getByRole('radio', { name: wanted })
            .first()
            .click({ timeout: LIMITS.stepTimeoutMs });
        await page
            .getByRole('button', { name: FACEBOOK.audienceDone })
            .first()
            .click({ timeout: LIMITS.stepTimeoutMs });

        const updated = audienceLabel(
            (await dialog
                .getByRole('button', { name: FACEBOOK.audienceButton })
                .first()
                .innerText({ timeout: LIMITS.stepTimeoutMs })) ?? '',
        );
        if (!wanted.test(updated)) {
            throw new StepError('audience_not_set');
        }
    } catch (error) {
        throw error instanceof StepError
            ? error
            : new StepError('audience_not_set');
    }
}

// * Ok only when the composer closed AND Facebook showed its "published" notice; anything less is `unknown`.
async function confirmPublished(page, dialog, text) {
    await dialog.waitFor({ state: 'hidden', timeout: LIMITS.confirmTimeoutMs });

    const notice = page
        .getByRole('status')
        .or(page.getByRole('alert'))
        .filter({ hasText: FACEBOOK.publishedToast })
        .first();

    // * The notice is short-lived, so the post showing up in the feed as "just now" counts as proof too. The snippet is the
    // * first line of what was typed; an older identical post cannot match because it must also read "just now".
    const snippet = firstLineSnippet(text);
    const fresh = snippet
        ? page
              .getByRole('article')
              .filter({ hasText: snippet })
              .filter({ hasText: FACEBOOK.justNow })
              .first()
        : null;

    const proof = await awaitPublishedProof(
        notice,
        fresh,
        LIMITS.confirmTimeoutMs,
    );

    const href =
        proof === 'notice'
            ? await notice
                  .getByRole('link', { name: FACEBOOK.viewPostLink })
                  .first()
                  .getAttribute('href', { timeout: 2_000 })
                  .catch(() => null)
            : null;

    return {
        ok: true,
        via: 'ui',
        url: href ? (cleanPostUrl(href) ?? undefined) : undefined,
    };
}

async function runPost(context, store, input, files) {
    const page = await openHome(context);

    if (await isCheckpoint(page, FACEBOOK)) {
        throw new StepError('checkpoint');
    }
    if (!(await hasSession(context))) {
        throw new StepError('not_logged_in');
    }

    if (input.groupUrl !== null) {
        return runGroupPost(page, input, files);
    }

    const tokens = await readPageTokens(context, page);
    saveTokens(store, tokens);
    const textOnly = files.length === 0;
    let capture = { template: null };

    try {
        const template =
            textOnly && tokens !== null ? readTemplate(store) : null;
        if (template !== null) {
            const viaApi = await postThroughApi(page, template, input, tokens);
            if (viaApi !== null) {
                return viaApi;
            }
            // * Definitively rejected (stale template): drop it, the UI post below captures a fresh one.
            discardTemplate(store);
        }

        // ! Watched only now: the API replay above is also a composer request and must never become the next template.
        capture = watchComposerRequest(page, {
            enabled: textOnly,
            text: input.text,
            audience: input.audience,
            userId: tokens?.userId ?? null,
        });
        return await postThroughComposer(page, input, files);
    } finally {
        if (capture.template !== null) {
            try {
                store.write({ template: capture.template });
            } catch {
                // * The template is a convenience for the API path; failing to save it never changes the post outcome.
            }
        }
    }
}

// * Attaches the files through the dialog's photo/video control and waits for every thumbnail. Nothing is posted yet.
async function attachImages(page, dialog, files) {
    try {
        const chooserPromise = page.waitForEvent('filechooser', {
            timeout: LIMITS.stepTimeoutMs,
        });
        await dialog
            .getByRole('button', { name: FACEBOOK.photoButton })
            .first()
            .click({ timeout: LIMITS.stepTimeoutMs });
        const chooser = await chooserPromise;
        await chooser.setFiles(files);

        const thumbnails = dialog.locator(FACEBOOK.attachmentImage);
        await thumbnails.nth(files.length - 1).waitFor({
            state: 'visible',
            timeout: LIMITS.imageUploadTimeoutMs,
        });
        await dialog
            .getByRole('button', { name: FACEBOOK.attachmentRemove })
            .first()
            .waitFor({
                state: 'visible',
                timeout: LIMITS.imageUploadTimeoutMs,
            });
    } catch {
        throw new StepError('image_upload_failed');
    }
}

async function postThroughComposer(page, input, files) {
    const { dialog, textbox } = await openComposer(page);
    await typeText(page, textbox, input.text, LIMITS);
    if (files.length > 0) {
        await attachImages(page, dialog, files);
    }
    await setAudience(page, dialog, input.audience);

    // * With an image the composer first shows "Tiếp"; this is only navigation, nothing is live until "Đăng".
    if (files.length > 0) {
        const next = dialog
            .getByRole('button', { name: FACEBOOK.nextButton })
            .last();
        if (await next.isVisible().catch(() => false)) {
            try {
                await next.click({ timeout: LIMITS.stepTimeoutMs });
            } catch {
                throw new StepError('composer_not_found');
            }
        }
    }

    // ! From the click on, the post may be live: every failure below is `unknown`, never retried as a failure.
    try {
        await dialog
            .getByRole('button', { name: FACEBOOK.submitButton })
            .last()
            .click({ timeout: LIMITS.stepTimeoutMs });
    } catch {
        throw new StepError('composer_not_found');
    }

    try {
        return await confirmPublished(page, dialog, input.text);
    } catch {
        // * A checkpoint here cannot prove the post did not go out, so it is `unknown` too.
        throw new StepError('unknown');
    }
}

// ===== Group posting: one post into one saved group through the group page's own composer. =====
// * Never uses the GraphQL template (that one is the personal timeline). No audience step: a group post is seen by the group.
// * Same rules as the timeline: failures before "Đăng" are fixed codes, from the click on any failure is `unknown`, never retried.
async function runGroupPost(page, input, files) {
    try {
        await page.goto(input.groupUrl, {
            waitUntil: 'domcontentloaded',
            timeout: LIMITS.stepTimeoutMs,
        });
    } catch {
        throw new StepError('timeout');
    }

    if (await isCheckpoint(page, FACEBOOK)) {
        throw new StepError('checkpoint');
    }

    let dialog;
    let textbox;
    try {
        await page
            .getByRole('button', { name: FACEBOOK.groupComposerTrigger })
            .first()
            .click({ timeout: LIMITS.stepTimeoutMs });
        dialog = page.getByRole('dialog').last();
        textbox = dialog
            .getByRole('textbox', { name: FACEBOOK.groupComposerTextbox })
            .first();
        await textbox.waitFor({
            state: 'visible',
            timeout: LIMITS.stepTimeoutMs,
        });
    } catch {
        throw new StepError('composer_not_found');
    }

    await typeText(page, textbox, input.text, LIMITS);
    if (files.length > 0) {
        await attachImages(page, dialog, files);
        const next = dialog
            .getByRole('button', { name: FACEBOOK.nextButton })
            .last();
        if (await next.isVisible().catch(() => false)) {
            try {
                await next.click({ timeout: LIMITS.stepTimeoutMs });
            } catch {
                throw new StepError('composer_not_found');
            }
        }
    }

    // ! From the click on, the post may be live.
    try {
        await dialog
            .getByRole('button', { name: FACEBOOK.submitButton })
            .last()
            .click({ timeout: LIMITS.stepTimeoutMs });
    } catch {
        throw new StepError('composer_not_found');
    }

    try {
        return await confirmPublished(page, dialog, input.text);
    } catch {
        throw new StepError('unknown');
    }
}
