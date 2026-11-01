// LinkedIn provider: posts text (optionally with images, no video) to the user's own feed by driving a REAL Chrome with a dedicated
// persistent profile. Plain Playwright: no stealth, fingerprint/user-agent/header/webdriver tweaks, no proxy or captcha tricks.
// A checkpoint/captcha is never bypassed: the operation stops with `checkpoint` and the human solves it.
// ! LinkedIn's terms restrict automated access: using this may get the account restricted. Every selector in ./selectors.mjs is
// ! UNVERIFIED against the live site and may need fixing there.
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
import { firstLineSnippet, sleep } from '../shared/util.mjs';
import {
    LEARN_MARKER,
    LINKEDIN,
    LINKEDIN_LIMITS as LIMITS,
} from './selectors.mjs';
import {
    audienceLabel,
    buildTemplate,
    classifyApiReply,
    isUsableTemplate,
    matchesAudience,
    postUrl,
    renderBody,
    resultFromUrl,
} from './template.mjs';

export const LINKEDIN_MODES = [
    'login',
    'check',
    'session',
    'learn',
    'groups',
    'post',
];

/**
 * @typedef {object} ProviderOptions
 * @property {string} [storageDirectory] Where the profile and template file live (default `~/.social-manager`).
 * @property {string} [profileDirectory] Overrides `<storageDirectory>/linkedin-profile`.
 * @property {string} [sessionFile] Overrides `<storageDirectory>/linkedin-session.json` (0600, request template only).
 * @property {boolean} [headless] Hide the window. Ignored for `login` and `learn` (a human must see it).
 */

/**
 * Creates the LinkedIn client. Every method resolves to ONE JSON-safe result object and never throws: success is `{ok: true, ...}`,
 * failure is `{ok: false, error: <fixed code>}` (see `ERROR_EXIT_CODES`). Results never contain cookies or page content.
 * @param {ProviderOptions} [options]
 */
export function createLinkedin(options = {}) {
    const storageDirectory =
        options.storageDirectory ?? path.join(os.homedir(), '.social-manager');
    const profileDirectory =
        options.profileDirectory ??
        path.join(storageDirectory, 'linkedin-profile');
    const store = createSessionStore(
        options.sessionFile ??
            path.join(storageDirectory, 'linkedin-session.json'),
        ['template'],
    );
    const headless = options.headless === true;

    const operation = (settings) =>
        runOperation({
            profileDirectory,
            headless,
            interactive: false,
            deadlineMs: LIMITS.postDeadlineMs,
            tempPrefix: 'linkedin-post-',
            limits: LIMITS,
            ...settings,
        });
    const interactive = {
        interactive: true,
        deadlineMs: LIMITS.loginDeadlineMs + 30_000,
    };

    const post = (input) =>
        operation({
            prepare: async (workspace) => {
                const parsed = parsePostInput(input, {
                    audienceOptions: LINKEDIN.audienceOptions,
                    groupPostUrl: LINKEDIN.groupPostUrl,
                    defaultAudience: 'public',
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
        /** Human logs in manually; resolves once the `li_at` cookie exists. */
        login: () =>
            operation({
                ...interactive,
                run: (context) =>
                    waitForLogin(context, {
                        homeUrl: LINKEDIN.homeUrl,
                        cookieName: LINKEDIN.loginSessionCookie,
                        limits: LIMITS,
                    }),
            }),
        /** `{ok: true, loggedIn: boolean}`. */
        check: () =>
            operation({
                reportLoggedOut: true,
                run: (context) => runCheck(context),
            }),
        /** Login check; also reports whether a replay template was captured. */
        session: () =>
            operation({
                reportLoggedOut: true,
                run: (context) => runSession(context, store),
            }),
        /**
         * Human posts the marker text once per audience in the opened window; the request is captured and BLOCKED
         * (nothing goes live) and turned into the replay template.
         */
        learn: () =>
            operation({
                ...interactive,
                run: (context) => runLearn(context, store),
            }),
        /** Read-only: `{ok: true, groups: [{id, name, url}]}` of the groups the account joined. */
        groups: () => operation({ run: (context) => runGroups(context) }),
        /**
         * @param {{text: string, audience?: 'public' | 'connections', images?: string[], group_url?: string}} input `images` are
         * http(s) URLs; with `group_url` (a group page) the post goes into that group instead of the feed.
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
    return openPage(context, LINKEDIN.homeUrl, LIMITS.stepTimeoutMs);
}

function hasSession(context) {
    return hasCookie(context, LINKEDIN.homeUrl, LINKEDIN.loginSessionCookie);
}

// * The cookie can outlive the session: a redirect to the login page means the human has to log in again.
async function isLoggedIn(context, page) {
    return (await hasSession(context)) && !LINKEDIN.loginUrl.test(page.url());
}

async function runCheck(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page, LINKEDIN)) {
        throw new StepError('checkpoint');
    }

    return { ok: true, loggedIn: await isLoggedIn(context, page) };
}

// * Returns the saved template only when it is complete; anything doubtful is "no template" (the UI path then runs).
function readTemplate(store) {
    const template = store.read().template;
    return isUsableTemplate(template) ? template : null;
}

function discardTemplate(store) {
    try {
        store.remove();
    } catch {
        // * Failing to drop a stale template only costs one more rejected attempt later.
    }
}

// * The human drives the composer once per audience (type LEARN_MARKER, pick the audience, press Post). The composer's own request
// * is turned into the replay template and ABORTED before it leaves the browser, so no post is created and no UI selector is needed.
async function runLearn(context, store) {
    const page = await openHome(context);

    if (await isCheckpoint(page, LINKEDIN)) {
        throw new StepError('checkpoint');
    }
    if (!(await isLoggedIn(context, page))) {
        throw new StepError('not_logged_in');
    }

    let learned = null;
    // ! Every POST carrying the marker is aborted, whatever its path: a marker post must never go live.
    await context.route(LINKEDIN.apiRoute, async (route) => {
        const request = route.request();
        if (
            request.method() !== 'POST' ||
            !(request.postData() ?? '').includes(LEARN_MARKER)
        ) {
            await route.continue().catch(() => undefined);
            return;
        }
        await route.abort().catch(() => undefined);
        try {
            for (const audience of Object.keys(LINKEDIN.apiVisibility)) {
                const template = buildTemplate(
                    request,
                    { text: LEARN_MARKER, audience },
                    readTemplate(store),
                );
                if (template !== null) {
                    store.write({ template });
                    learned = audience;
                    return;
                }
            }
        } catch {
            // * An unreadable request is not the composer request; keep waiting.
        }
    });

    process.stderr.write(
        `In the Chrome window: Start a post, type exactly "${LEARN_MARKER}", pick the audience, press Post.\n` +
            'The post is blocked and NOT published. Run again for the other audience.\n',
    );

    const deadline = Date.now() + LIMITS.loginDeadlineMs;
    while (learned === null && Date.now() < deadline) {
        if (page.isClosed()) {
            throw new StepError('unknown');
        }
        await sleep(LIMITS.loginPollMs);
    }
    if (learned === null) {
        throw new StepError('timeout');
    }

    return {
        ok: true,
        learned,
        audiences: Object.keys(readTemplate(store)?.visibility ?? {}),
    };
}

async function runGroups(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page, LINKEDIN)) {
        throw new StepError('checkpoint');
    }
    if (!(await isLoggedIn(context, page))) {
        throw new StepError('not_logged_in');
    }

    return scrapeGroups(
        page,
        {
            groupsUrl: LINKEDIN.groupsUrl,
            hostname: 'www.linkedin.com',
            groupPath: LINKEDIN.groupPath,
            groupLinkLabel: LINKEDIN.groupLinkLabel,
            groupUrl: (id) => `https://www.linkedin.com/groups/${id}/`,
        },
        LIMITS,
    );
}

async function runSession(context, store) {
    const page = await openHome(context);

    if (await isCheckpoint(page, LINKEDIN)) {
        throw new StepError('checkpoint');
    }
    if (!(await isLoggedIn(context, page))) {
        return { ok: true, loggedIn: false };
    }

    return { ok: true, loggedIn: true, template: readTemplate(store) !== null };
}

// * Remembers the composer's own request (text-only posts) as a replay template. Nothing is sent or altered.
function watchComposerRequest(page, context, store) {
    const captured = { template: null };
    page.on('request', (request) => {
        try {
            if (
                !context.enabled ||
                request.method() !== 'POST' ||
                !LINKEDIN.apiPathHint.test(new URL(request.url()).pathname)
            ) {
                return;
            }
            captured.template =
                buildTemplate(request, context, readTemplate(store)) ??
                captured.template;
        } catch {
            // * An unreadable request is simply not the composer request.
        }
    });
    return captured;
}

// * Replays the template with a fetch INSIDE the logged-in page. Returns the result, or null when the request was
// * definitively rejected (the caller may then use the UI once), or 'skipped' when nothing was sent. Anything ambiguous throws
// * `unknown`: no fallback, no retry.
async function postThroughApi(page, template, input) {
    if (typeof template.visibility[input.audience] !== 'string') {
        return 'skipped'; // * this audience was never observed in the composer's own request
    }

    let reply;
    try {
        reply = await page.evaluate(
            async ({
                apiPath,
                body,
                requestHeaders,
                csrfCookie,
                csrfHeader,
                timeoutMs,
            }) => {
                // * The web app's own mechanism: the csrf-token header repeats the JSESSIONID cookie value.
                const pair = document.cookie
                    .split('; ')
                    .find((item) => item.startsWith(`${csrfCookie}=`));
                const csrf = pair
                    ?.slice(csrfCookie.length + 1)
                    .replace(/^"|"$/g, '');
                if (!csrf) {
                    return { skipped: true };
                }
                const response = await fetch(apiPath, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { ...requestHeaders, [csrfHeader]: csrf },
                    body,
                    signal: AbortSignal.timeout(timeoutMs),
                });
                return {
                    status: response.status,
                    restliId: response.headers.get('x-restli-id'),
                    text: await response.text(),
                };
            },
            {
                apiPath: template.path,
                body: JSON.stringify(renderBody(template, input)),
                requestHeaders: template.headers,
                csrfCookie: LINKEDIN.csrfCookie,
                csrfHeader: LINKEDIN.csrfHeader,
                timeoutMs: LIMITS.apiRequestTimeoutMs,
            },
        );
    } catch {
        // ! Network error, timeout or a navigation while the request was in flight: it may have been delivered.
        throw new StepError('unknown');
    }

    if (reply.skipped === true) {
        return 'skipped'; // * no request was made
    }

    const outcome = classifyApiReply(
        reply.status,
        String(reply.text),
        reply.restliId,
    );
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
        url: postUrl(outcome.postId),
    };
}

async function openComposer(page) {
    const trigger = page
        .getByRole('button', { name: LINKEDIN.composerTrigger })
        .first();
    try {
        await trigger.click({ timeout: LIMITS.stepTimeoutMs });
        const dialog = page.getByRole('dialog').last();
        const textbox = dialog.getByRole(LINKEDIN.composerTextbox).first();
        await textbox.waitFor({
            state: 'visible',
            timeout: LIMITS.stepTimeoutMs,
        });
        return { dialog, textbox };
    } catch {
        throw new StepError('composer_not_found');
    }
}

// ! Never submit with an audience that was not verified: a public post when "connections only" was meant is worse than a failed post.
async function setAudience(page, dialog, audience) {
    const wanted = LINKEDIN.audienceOptions[audience];
    const readLabel = async () =>
        audienceLabel(
            (await dialog
                .getByRole('button', { name: LINKEDIN.audienceButton })
                .first()
                .innerText({ timeout: LIMITS.stepTimeoutMs })) ?? '',
        );

    try {
        if (matchesAudience(await readLabel(), audience)) {
            return;
        }

        await dialog
            .getByRole('button', { name: LINKEDIN.audienceButton })
            .first()
            .click({ timeout: LIMITS.stepTimeoutMs });
        // * The newer dropdown draws the radio under its row, so a direct check can be blocked: fall back to clicking the row's text.
        try {
            await page
                .getByRole('radio', { name: wanted })
                .first()
                .check({ timeout: 4_000 });
        } catch {
            await page
                .getByText(wanted)
                .first()
                .click({ timeout: LIMITS.stepTimeoutMs });
        }
        // * The newer dropdown has no Done button and applies the radio at once; the older dialog needs it. Press it only when present.
        const done = page
            .getByRole('button', { name: LINKEDIN.audienceDone })
            .last();
        if (await done.isVisible()) {
            await done.click({ timeout: LIMITS.stepTimeoutMs });
        } else {
            // * Escape does not close the newer popup: toggle it shut with the same button that opened it, so it stops covering the textbox.
            const popup = page.getByText(LINKEDIN.audiencePopupTitle).first();
            await dialog
                .getByRole('button', { name: LINKEDIN.audienceButton })
                .first()
                .click({ timeout: LIMITS.stepTimeoutMs });
            await popup.waitFor({
                state: 'hidden',
                timeout: LIMITS.stepTimeoutMs,
            });
        }

        if (!matchesAudience(await readLabel(), audience)) {
            throw new StepError('audience_not_set');
        }
    } catch (error) {
        throw error instanceof StepError
            ? error
            : new StepError('audience_not_set');
    }
}

// * Ok only when the composer closed AND LinkedIn showed its "post successful" notice or the post is the newest "just now" one
// * in the feed; anything less is `unknown`.
async function confirmPublished(page, dialog, text) {
    await dialog.waitFor({ state: 'hidden', timeout: LIMITS.confirmTimeoutMs });

    const notice = page
        .getByRole('status')
        .or(page.getByRole('alert'))
        .filter({ hasText: LINKEDIN.publishedToast })
        .first();

    // * The notice is short-lived, so the post showing up in the feed as "just now" counts as proof too. The snippet is the
    // * first line of what was typed; an older identical post cannot match because it must also read "just now".
    const snippet = firstLineSnippet(text);
    const fresh = snippet
        ? page
              .locator(LINKEDIN.feedPost)
              .filter({ hasText: snippet })
              .filter({ hasText: LINKEDIN.justNow })
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
                  .getByRole('link', { name: LINKEDIN.viewPostLink })
                  .first()
                  .getAttribute('href', { timeout: 2_000 })
                  .catch(() => null)
            : ((await fresh
                  .getAttribute('data-urn', { timeout: 2_000 })
                  .catch(() => null)) ?? null);

    return proof === 'feed' && href !== null
        ? resultFromUrl(
              LINKEDIN.postUrnPattern.test(href) ? postUrl(href) : null,
          )
        : resultFromUrl(href);
}

async function runPost(context, store, input, files) {
    const page = await openHome(context);

    if (await isCheckpoint(page, LINKEDIN)) {
        throw new StepError('checkpoint');
    }
    if (!(await isLoggedIn(context, page))) {
        throw new StepError('not_logged_in');
    }

    if (input.groupUrl !== null) {
        return runGroupPost(context, input, files);
    }

    const textOnly = files.length === 0;
    let capture = { template: null };

    try {
        const template = textOnly ? readTemplate(store) : null;
        if (template !== null) {
            const viaApi = await postThroughApi(page, template, input);
            if (viaApi === null) {
                // * Definitively rejected (stale template): drop it, the UI post below captures a fresh one.
                discardTemplate(store);
            } else if (viaApi !== 'skipped') {
                return viaApi;
            }
        }

        // ! Watched only now: the API replay above is also a composer request and must never become the next template.
        capture = watchComposerRequest(
            page,
            {
                enabled: textOnly,
                text: input.text,
                audience: input.audience,
            },
            store,
        );
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

// * Attaches the files through the dialog's photo control and waits for every thumbnail. Nothing is posted yet.
async function attachImages(page, dialog, files) {
    try {
        const chooserPromise = page.waitForEvent('filechooser', {
            timeout: LIMITS.stepTimeoutMs,
        });
        await dialog
            .getByRole('button', { name: LINKEDIN.photoButton })
            .first()
            .click({ timeout: LIMITS.stepTimeoutMs });
        const chooser = await chooserPromise;
        await chooser.setFiles(files);

        // * The editor step ("Tiếp"/"Next") only leads back to the composer; nothing is live until "Đăng".
        const editorNext = page
            .getByRole('dialog')
            .last()
            .getByRole('button', { name: LINKEDIN.editorNext })
            .last();
        await editorNext.click({ timeout: LIMITS.imageUploadTimeoutMs });

        const thumbnails = dialog.locator(LINKEDIN.attachmentImage);
        await thumbnails.nth(files.length - 1).waitFor({
            state: 'visible',
            timeout: LIMITS.imageUploadTimeoutMs,
        });
        await dialog
            .getByRole('button', { name: LINKEDIN.attachmentRemove })
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
    // * Audience first: when it cannot be verified nothing has been typed or uploaded yet.
    await setAudience(page, dialog, input.audience);
    await typeText(page, textbox, input.text, LIMITS);
    if (files.length > 0) {
        await attachImages(page, dialog, files);
    }

    // ! From the click on, the post may be live: every failure below is `unknown`, never retried as a failure.
    try {
        await dialog
            .getByRole('button', { name: LINKEDIN.submitButton })
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
// * Never uses the captured-request replay (that template belongs to the feed). No audience step: a group post is seen by the group.
// * Same rules as the feed: every failure before "Đăng" is a fixed code, from the click on any failure is `unknown`, never retried.
async function runGroupPost(context, input, files) {
    const page = context.pages()[0] ?? (await context.newPage());
    try {
        await page.goto(input.groupUrl, {
            waitUntil: 'domcontentloaded',
            timeout: LIMITS.stepTimeoutMs,
        });
    } catch {
        throw new StepError('timeout');
    }

    if (await isCheckpoint(page, LINKEDIN)) {
        throw new StepError('checkpoint');
    }
    if (!(await isLoggedIn(context, page))) {
        throw new StepError('not_logged_in');
    }

    const trigger = page
        .getByRole('button', { name: LINKEDIN.groupComposerTrigger })
        .first();
    let dialog;
    let textbox;
    try {
        await trigger.click({ timeout: LIMITS.stepTimeoutMs });
        dialog = page.getByRole('dialog').last();
        textbox = dialog.getByRole(LINKEDIN.composerTextbox).first();
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
    }

    // ! From the click on, the post may be live.
    try {
        await dialog
            .getByRole('button', { name: LINKEDIN.submitButton })
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
