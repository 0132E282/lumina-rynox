#!/usr/bin/env node
// Posts text (optionally with images, no video) to the user's own LinkedIn feed by driving a REAL, visible Chrome with a dedicated persistent profile.
// Runs on the user's machine only. Plain Playwright: no stealth plugins, no fingerprint/user-agent/header/webdriver tweaks, no proxy
// or captcha tricks. A checkpoint/captcha is never bypassed: the script stops with `checkpoint` and the human solves it.
// ! LinkedIn's terms restrict automated access: using this may get the account restricted. Every selector below is UNVERIFIED
// ! against the live site and may need fixing in the LINKEDIN block.
//
// Usage:
//   node scripts/linkedin-post.mjs login   # human logs in manually; the window stays open until the `li_at` cookie exists
//   node scripts/linkedin-post.mjs groups  # read-only: prints {"ok":true,"groups":[{id,name,url}]} of the groups the account joined
//   node scripts/linkedin-post.mjs check   # prints {"ok":true,"loggedIn":bool}
//   node scripts/linkedin-post.mjs learn   # human posts the marker text once per audience; the request is captured and BLOCKED (nothing goes live)
//   node scripts/linkedin-post.mjs cookie  # reuses the logged-in profile and saves its cookie to storage/app/linkedin-cookie.json (login does this too)
//   node scripts/linkedin-post.mjs session # login check; also reports whether a replay template was captured
//   echo '{"text":"...","audience":"public","images":["https://..."]}' | node scripts/linkedin-post.mjs post
//
// Output: exactly one JSON line on stdout, only fixed error codes (never page content, cookies or profile data).
// Template file (storage/app/linkedin-session.json, 0600, gitignored, never printed or logged): the composer's own request,
// captured the first time a post goes through the UI, with the text/visibility/ids replaced by placeholders. No cookie or token is
// stored. A later text-only post replays that request INSIDE the logged-in page (`via: "browser-api"`); the csrf-token header is
// read in-page, on every run, from the page's own JSESSIONID cookie (the web app's own mechanism). Only a DEFINITIVE rejection falls
// back, once, to the UI (`via: "ui"`); any ambiguous API result is `unknown` and never retried. Posts with images use the UI.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ERROR_EXIT_CODES = {
    unknown: 1,
    not_logged_in: 10,
    composer_not_found: 11,
    timeout: 12,
    checkpoint: 13,
    invalid_input: 14,
    audience_not_set: 15,
    browser_unavailable: 16,
    image_download_failed: 17,
    image_upload_failed: 18,
};

// ! Every selector/text LinkedIn can change lives here (Vietnamese + English). Fix a break in this block only. UNVERIFIED.
const LINKEDIN = {
    groupsUrl: 'https://www.linkedin.com/groups/',
    // * Group links look like /groups/<numeric id>/; anything else under /groups/ is not a group.
    groupPath: /^\/groups\/(\d{3,15})\/?$/,
    groupLinkLabel: /^(xem nhóm|view group|vào nhóm|join|tham gia)$/i,
    // * Group posting (bulk). ALL UNVERIFIED against the live site: the group page's own composer trigger and its text/wording.
    groupPostUrl: /^https:\/\/www\.linkedin\.com\/groups\/\d{3,15}\/?$/,
    groupComposerTrigger:
        /bắt đầu thảo luận|bắt đầu bài đăng|start a conversation|start a post|start a discussion/i,
    homeUrl: 'https://www.linkedin.com/feed/',
    loginSessionCookie: 'li_at', // * only its presence is tested, the value is never read or printed
    csrfCookie: 'JSESSIONID', // * read in the page for the csrf-token header, never stored or printed
    loginUrl: /\/(login|uas\/login|authwall|signup)\b/i,
    checkpointUrl: /\/(checkpoint|challenge)\b|captcha/i,
    checkpointText:
        /xác minh bạn là người thật|kiểm tra bảo mật nhanh|quick security check|let(?:'|’)s do a quick security check|verify you(?:'|’)re (?:a )?human/i,
    composerTrigger: /bắt đầu bài đăng|start a post/i,
    composerTextbox: 'textbox',
    // * The visibility control of the composer; its text is "Mọi người" / "Anyone" (optionally preceded by a prefix).
    audienceButton:
        /mọi người|anyone|chỉ kết nối|connections only|ai có thể xem bài đăng|who can see your post|cài đặt bài đăng|post settings/i,
    audienceButtonPrefix:
        /^(ai có thể xem bài đăng của bạn\??|who can see your post\??|cài đặt bài đăng|post settings|chọn đối tượng|select audience|đăng cho|post to)\s*/i,
    audiencePopupTitle:
        /^(ai có thể xem bài đăng của bạn\??|who can see your post\??)$/i,
    audienceDone: /^(xong|done|lưu|save)$/i,
    audienceOptions: {
        public: /^(mọi người|anyone)/i,
        connections: /^(chỉ kết nối|connections only|kết nối|connections)/i,
    },
    photoButton: /thêm ảnh|add a photo|add photo/i,
    // * After choosing files LinkedIn shows an editor step with "Tiếp"/"Next"; the composer comes back after it.
    editorNext: /^(tiếp|next)$/i,
    // * Thumbnails are blob: previews (avatars are not); the remove-button of an attachment must be there too.
    attachmentRemove:
        /xóa ảnh|xoá ảnh|gỡ ảnh|loại bỏ ảnh|remove (?:photo|image|media)|delete (?:photo|image)/i,
    attachmentImage: 'img[src^="blob:"]',
    submitButton: /^(đăng|post)$/i,
    publishedToast: /đăng bài thành công|đã đăng|post successful/i,
    justNow: /vừa xong|just now/i,
    feedPost: '[data-urn^="urn:li:activity"], [role="article"]',
    viewPostLink: /xem bài đăng|view post/i,
    postUrnPattern: /urn:li:(?:share|ugcPost|activity):\d{5,30}/,
    postUrlPath: /^\/feed\/update\//,
    // * In-browser API replay. A captured request is recognised by path, JSON body and by finding the typed text and visibility by value.
    apiPathPattern: /^\/voyager\/api\/[A-Za-z0-9_\-./?=&%:,()@]{1,400}$/,
    // * `learn` blocks any POST under this path whose body carries LEARN_MARKER.
    apiRoute: '**/voyager/api/**',
    apiPathHint: /contentcreation|sharing|shares|posts?\b/i,
    replayHeaders: [
        'content-type',
        'accept',
        'x-restli-protocol-version',
        'x-li-lang',
        'x-li-track',
    ],
    csrfHeader: 'csrf-token',
    // * Visibility values as the composer's own request carries them; only the observed one per audience is stored and replayed.
    apiVisibility: {
        public: /^(ANYONE|PUBLIC)$/i,
        connections: /^(CONNECTIONS(?:_ONLY)?)$/i,
    },
    uuidPattern:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    // * Keys whose non-empty value ties a template to one specific post (media, mentions/hashtag entities): never templated.
    unsafeVariableKeys:
        /^(media|mediaUrns?|mediaCategory|attributes|attributesV2|attachments?|originalShare|reshare\w*|poll\w*|article\w*|document\w*)$/i,
};

const LIMITS = {
    groupScrollRounds: 12,
    groupsMax: 200,
    groupNameMax: 150,
    textMaxLength: 3000,
    typingDelayMs: 25,
    stepTimeoutMs: 20_000,
    confirmTimeoutMs: 45_000,
    imageMaxBytes: 10 * 1024 * 1024,
    imageDownloadTimeoutMs: 20_000,
    imageMaxCount: 9,
    imageUploadTimeoutMs: 40_000,
    apiRequestTimeoutMs: 30_000,
    postDeadlineMs: 150_000, // * below the 180 s the Laravel side allows
    loginDeadlineMs: 10 * 60_000,
    loginPollMs: 2_000,
};

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIRECTORY = path.resolve(
    SCRIPT_DIRECTORY,
    '..',
    'storage',
    'app',
);
const PROFILE_DIRECTORY = path.join(STORAGE_DIRECTORY, 'linkedin-profile');
const SESSION_FILE = path.join(STORAGE_DIRECTORY, 'linkedin-session.json');
const COOKIE_FILE = path.join(STORAGE_DIRECTORY, 'linkedin-cookie.json');

class StepError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function emit(result) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function parsePostInput(raw) {
    let input;
    try {
        input = JSON.parse(raw);
    } catch {
        throw new StepError('invalid_input');
    }

    const text =
        typeof input?.text === 'string'
            ? input.text.replace(/\r\n?/g, '\n').trim()
            : '';
    const audience = input?.audience ?? 'public';

    if (
        text === '' ||
        text.length > LIMITS.textMaxLength ||
        !Object.hasOwn(LINKEDIN.audienceOptions, audience)
    ) {
        throw new StepError('invalid_input');
    }

    const rawImages = input?.images ?? [];
    if (!Array.isArray(rawImages) || rawImages.length > LIMITS.imageMaxCount) {
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
        groupUrl: parseGroupUrl(input?.group_url),
    };
}

// * Optional `group_url` (bulk group posting): only a group page of linkedin.com is accepted, anything else is invalid input.
function parseGroupUrl(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string' || !LINKEDIN.groupPostUrl.test(value)) {
        throw new StepError('invalid_input');
    }
    return value;
}

const IMAGE_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
};

// * Downloads one image to the temp directory. Any problem is the fixed code; the URL is never reported.
async function downloadImage(url, directory, index) {
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(LIMITS.imageDownloadTimeoutMs),
        });
        const type = (response.headers.get('content-type') ?? '')
            .split(';')[0]
            .trim()
            .toLowerCase();
        const declared = Number(response.headers.get('content-length') ?? 0);
        if (
            !response.ok ||
            !type.startsWith('image/') ||
            declared > LIMITS.imageMaxBytes
        ) {
            throw new Error('rejected');
        }

        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > LIMITS.imageMaxBytes) {
                throw new Error('too_large');
            }
            chunks.push(chunk);
        }
        if (size === 0) {
            throw new Error('empty');
        }

        const file = path.join(
            directory,
            `image-${index}${IMAGE_EXTENSIONS[type] ?? '.img'}`,
        );
        fs.writeFileSync(file, Buffer.concat(chunks), { mode: 0o600 });
        return file;
    } catch {
        throw new StepError('image_download_failed');
    }
}

async function downloadImages(urls, directory) {
    const files = [];
    for (let index = 0; index < urls.length; index += 1) {
        files.push(await downloadImage(urls[index], directory, index));
    }
    return files;
}

async function openContext() {
    try {
        return await chromium.launchPersistentContext(PROFILE_DIRECTORY, {
            channel: 'chrome',
            // * Hidden only on request and never for `login` (a human must see the window).
            headless:
                process.env.LINKEDIN_HEADLESS === '1' &&
                !['login', 'learn'].includes(process.argv[2]),
        });
    } catch {
        // ! The launch error can name local paths: only the fixed code leaves this script.
        throw new StepError('browser_unavailable');
    }
}

async function hasSession(context) {
    const cookies = await context.cookies(LINKEDIN.homeUrl);
    return cookies.some(
        (cookie) => cookie.name === LINKEDIN.loginSessionCookie,
    );
}

async function isCheckpoint(page) {
    if (LINKEDIN.checkpointUrl.test(page.url())) {
        return true;
    }
    return page
        .getByText(LINKEDIN.checkpointText)
        .first()
        .isVisible()
        .catch(() => false);
}

async function openHome(context) {
    const page = context.pages()[0] ?? (await context.newPage());
    try {
        await page.goto(LINKEDIN.homeUrl, {
            waitUntil: 'domcontentloaded',
            timeout: LIMITS.stepTimeoutMs,
        });
    } catch {
        throw new StepError('timeout');
    }
    return page;
}

// ! The cookie header of the signed-in profile, for the HTTP posting path (LinkedInWebClient). 0600, gitignored, never printed or logged.
async function saveCookie(context) {
    const cookies = (await context.cookies(LINKEDIN.homeUrl)).filter(
        (cookie) => !/[\r\n;]/.test(cookie.name + cookie.value),
    );
    if (
        !cookies.some((cookie) => cookie.name === LINKEDIN.loginSessionCookie)
    ) {
        throw new StepError('not_logged_in');
    }
    fs.writeFileSync(
        COOKIE_FILE,
        JSON.stringify({
            cookie: cookies
                .map((cookie) => `${cookie.name}=${cookie.value}`)
                .join('; '),
            saved_at: new Date().toISOString(),
        }),
        { mode: 0o600 },
    );
    fs.chmodSync(COOKIE_FILE, 0o600);
}

// * Reuses the saved profile (no window, no login) and refreshes the cookie file; fails with `not_logged_in` when the session is gone.
async function runCookie(context) {
    const page = await openHome(context);
    if (!(await isLoggedIn(context, page))) {
        throw new StepError('not_logged_in');
    }
    await saveCookie(context);
    return { ok: true, loggedIn: true, cookie: true };
}

async function runLogin(context) {
    const page = await openHome(context);
    const deadline = Date.now() + LIMITS.loginDeadlineMs;

    while (Date.now() < deadline) {
        if (await hasSession(context)) {
            await sleep(3_000); // * let the browser persist the session into the profile before closing
            await saveCookie(context);
            return { ok: true, loggedIn: true, cookie: true };
        }
        if (page.isClosed()) {
            throw new StepError('not_logged_in');
        }
        await sleep(LIMITS.loginPollMs);
    }

    throw new StepError('timeout');
}

// * The cookie can outlive the session: a redirect to the login page means the human has to log in again.
async function isLoggedIn(context, page) {
    return (await hasSession(context)) && !LINKEDIN.loginUrl.test(page.url());
}

async function runCheck(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page)) {
        throw new StepError('checkpoint');
    }

    return { ok: true, loggedIn: await isLoggedIn(context, page) };
}

const LEARN_MARKER = 'linkedin-learn-do-not-post';

// * The human drives the composer once per audience (type LEARN_MARKER, pick the audience, press Post). The composer's own request
// * is turned into the replay template and ABORTED before it leaves the browser, so no post is created and no UI selector is needed.
async function runLearn(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page)) {
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
                const template = buildTemplate(request, {
                    text: LEARN_MARKER,
                    audience,
                });
                if (template !== null) {
                    writeTemplate(template);
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
        audiences: Object.keys(readTemplate()?.visibility ?? {}),
    };
}

// * Read-only: scrolls the "my groups" page and collects id, name and link of each group. Nothing is clicked, joined or posted.
async function runGroups(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page)) {
        throw new StepError('checkpoint');
    }
    if (!(await isLoggedIn(context, page))) {
        throw new StepError('not_logged_in');
    }

    try {
        await page.goto(LINKEDIN.groupsUrl, {
            waitUntil: 'domcontentloaded',
            timeout: LIMITS.stepTimeoutMs,
        });
    } catch {
        throw new StepError('timeout');
    }

    const groups = new Map();
    let idleRounds = 0;
    for (
        let round = 0;
        round < LIMITS.groupScrollRounds && idleRounds < 2;
        round += 1
    ) {
        const links = await page
            .evaluate(() =>
                [...document.querySelectorAll('a[href*="/groups/"]')].map(
                    (anchor) => ({
                        href: anchor.href,
                        text: (
                            anchor.innerText ||
                            anchor.getAttribute('aria-label') ||
                            ''
                        ).trim(),
                    }),
                ),
            )
            .catch(() => []);

        const before = groups.size;
        for (const link of links) {
            let url;
            try {
                url = new URL(link.href);
            } catch {
                continue;
            }
            const match = LINKEDIN.groupPath.exec(url.pathname);
            if (url.hostname !== 'www.linkedin.com' || match === null) {
                continue;
            }
            const name = (
                link.text.split('\n').find((line) => line.trim() !== '') ?? ''
            )
                .trim()
                .slice(0, LIMITS.groupNameMax);
            const previous = groups.get(match[1]);
            if (
                previous === undefined ||
                (previous.name === '' && name !== '')
            ) {
                groups.set(match[1], {
                    id: match[1],
                    name: LINKEDIN.groupLinkLabel.test(name) ? '' : name,
                    url: `https://www.linkedin.com/groups/${match[1]}/`,
                });
            }
        }

        idleRounds = groups.size === before ? idleRounds + 1 : 0;
        await page.mouse.wheel(0, 2500);
        await sleep(1_200);
    }

    return {
        ok: true,
        groups: [...groups.values()]
            .filter((group) => group.name !== '')
            .slice(0, LIMITS.groupsMax),
    };
}

async function runSession(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page)) {
        throw new StepError('checkpoint');
    }
    if (!(await isLoggedIn(context, page))) {
        return { ok: true, loggedIn: false };
    }

    return { ok: true, loggedIn: true, template: readTemplate() !== null };
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// * Applies `transform` to every string value (not key) of a JSON-like structure and returns the new structure.
function mapStrings(value, transform) {
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

function hasUnsafeField(value) {
    if (Array.isArray(value)) {
        return value.some(hasUnsafeField);
    }
    if (!isPlainObject(value)) {
        return false;
    }
    return Object.entries(value).some(
        ([key, item]) =>
            (LINKEDIN.unsafeVariableKeys.test(key) &&
                (Array.isArray(item)
                    ? item.length > 0
                    : isPlainObject(item)
                      ? Object.keys(item).length > 0
                      : typeof item === 'string' && item !== '')) ||
            hasUnsafeField(item),
    );
}

function readSessionFile() {
    try {
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
        return isPlainObject(data) ? data : {};
    } catch {
        return {};
    }
}

// ! 0600, gitignored, never printed or logged. Holds only the request template (no cookie, no token).
function writeTemplate(template) {
    fs.writeFileSync(
        SESSION_FILE,
        JSON.stringify({ template, saved_at: new Date().toISOString() }),
        { mode: 0o600 },
    );
    fs.chmodSync(SESSION_FILE, 0o600);
}

// * Returns the saved template only when it is complete; anything doubtful is "no template" (the UI path then runs).
function readTemplate() {
    try {
        const template = readSessionFile().template;
        if (
            !isPlainObject(template) ||
            typeof template.path !== 'string' ||
            !LINKEDIN.apiPathPattern.test(template.path) ||
            !isPlainObject(template.headers) ||
            !Object.values(template.headers).every(
                (value) => typeof value === 'string',
            ) ||
            !isPlainObject(template.body) ||
            !isPlainObject(template.visibility) ||
            !Object.values(template.visibility).every(
                (value) => typeof value === 'string',
            )
        ) {
            return null;
        }
        const serialized = JSON.stringify(template.body);
        return serialized.includes('"{{text}}"') &&
            serialized.includes('"{{visibility}}"')
            ? template
            : null;
    } catch {
        return null;
    }
}

function discardTemplate() {
    try {
        fs.rmSync(SESSION_FILE, { force: true });
    } catch {
        // * Failing to drop a stale template only costs one more rejected attempt later.
    }
}

// * Turns the composer's real request into a template: the typed text, the visibility value and UUID-like ids become placeholders.
// * Returns null when the text or visibility cannot be found by value, or the request carries media/mention/hashtag entities.
function buildTemplate(request, { text, audience }) {
    const url = new URL(request.url());
    const apiPath = `${url.pathname}${url.search}`;
    let body;
    try {
        body = JSON.parse(request.postData() ?? '');
    } catch {
        return null;
    }
    if (
        !isPlainObject(body) ||
        !LINKEDIN.apiPathPattern.test(apiPath) ||
        hasUnsafeField(body)
    ) {
        return null;
    }

    const visibilityPattern = LINKEDIN.apiVisibility[audience];
    const found = { text: 0, visibility: 0 };
    let observed = null;
    const uuids = new Map();
    const templated = mapStrings(body, (value) => {
        if (value === text) {
            found.text += 1;
            return '{{text}}';
        }
        if (visibilityPattern.test(value)) {
            found.visibility += 1;
            observed = value;
            return '{{visibility}}';
        }
        if (LINKEDIN.uuidPattern.test(value)) {
            if (!uuids.has(value)) {
                uuids.set(value, uuids.size);
            }
            return `{{uuid:${uuids.get(value)}}}`;
        }
        return value;
    });
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
    const previous = readTemplate();
    const visibility = {
        ...(previous?.path === apiPath ? previous.visibility : {}),
        [audience]: observed,
    };
    return { path: apiPath, headers, body: templated, visibility };
}

// * Remembers the composer's own request (text-only posts) as a replay template. Nothing is sent or altered.
function watchComposerRequest(page, context) {
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
                buildTemplate(request, context) ?? captured.template;
        } catch {
            // * An unreadable request is simply not the composer request.
        }
    });
    return captured;
}

function renderBody(template, input) {
    const uuids = new Map();
    return mapStrings(template.body, (value) => {
        switch (value) {
            case '{{text}}':
                return input.text;
            case '{{visibility}}':
                return template.visibility[input.audience];
            default: {
                const match = /^\{\{uuid:(\d+)\}\}$/.exec(value);
                if (match === null) {
                    return value;
                }
                if (!uuids.has(match[1])) {
                    uuids.set(match[1], randomUUID());
                }
                return uuids.get(match[1]);
            }
        }
    });
}

function findPostUrn(value) {
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

// * 'ok' (post urn found), 'rejected' (provably not posted: 4xx, or only `errors` without data) or 'unknown' (may have posted).
function classifyApiReply(status, text, restliId) {
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

function postUrl(postId) {
    return `https://www.linkedin.com/feed/update/${postId}/`;
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

async function typeText(page, textbox, text) {
    try {
        await textbox.click({ timeout: LIMITS.stepTimeoutMs });
        const lines = text.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            if (index > 0) {
                await page.keyboard.press('Enter');
            }
            if (lines[index] !== '') {
                await page.keyboard.type(lines[index], {
                    delay: LIMITS.typingDelayMs,
                });
            }
        }
    } catch {
        throw new StepError('composer_not_found');
    }
}

function audienceLabel(text) {
    return text.replace(LINKEDIN.audienceButtonPrefix, '').trim();
}

// * True only when the label is the wanted audience and none of the others.
function matchesAudience(label, audience) {
    return Object.entries(LINKEDIN.audienceOptions).every(
        ([key, pattern]) => pattern.test(label) === (key === audience),
    );
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

function cleanPostUrl(href) {
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

function resultFromUrl(url) {
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
    const snippet = text
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '')
        ?.slice(0, 40);
    const fresh = snippet
        ? page
              .locator(LINKEDIN.feedPost)
              .filter({ hasText: snippet })
              .filter({ hasText: LINKEDIN.justNow })
              .first()
        : null;

    const proofs = [
        notice
            .waitFor({ state: 'visible', timeout: LIMITS.confirmTimeoutMs })
            .then(() => 'notice'),
    ];
    if (fresh !== null) {
        proofs.push(
            fresh
                .waitFor({
                    state: 'visible',
                    timeout: LIMITS.confirmTimeoutMs,
                })
                .then(() => 'feed'),
        );
    }
    const proof = await Promise.any(proofs);

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

async function runPost(context, input, files) {
    const page = await openHome(context);

    if (await isCheckpoint(page)) {
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
        const template = textOnly ? readTemplate() : null;
        if (template !== null) {
            const viaApi = await postThroughApi(page, template, input);
            if (viaApi === null) {
                // * Definitively rejected (stale template): drop it, the UI post below captures a fresh one.
                discardTemplate();
            } else if (viaApi !== 'skipped') {
                return viaApi;
            }
        }

        // ! Watched only now: the API replay above is also a composer request and must never become the next template.
        capture = watchComposerRequest(page, {
            enabled: textOnly,
            text: input.text,
            audience: input.audience,
        });
        return await postThroughComposer(page, input, files);
    } finally {
        if (capture.template !== null) {
            try {
                writeTemplate(capture.template);
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
    await typeText(page, textbox, input.text);
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

// ===== Group posting (bulk, ADDITIVE): one post into one saved group through the group page's own composer. =====
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

    if (await isCheckpoint(page)) {
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

    await typeText(page, textbox, input.text);
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

async function main() {
    const mode = process.argv[2];
    if (
        ![
            'login',
            'check',
            'session',
            'cookie',
            'learn',
            'groups',
            'post',
        ].includes(mode)
    ) {
        emit({ ok: false, error: 'invalid_input' });
        return ERROR_EXIT_CODES.invalid_input;
    }

    let context = null;
    let deadlineTimer = null;
    let tempDirectory = null;

    try {
        const input =
            mode === 'post' ? parsePostInput(await readStdin()) : null;
        let files = [];
        if (input?.images.length > 0) {
            tempDirectory = fs.mkdtempSync(
                path.join(os.tmpdir(), 'linkedin-post-'),
            );
            files = await downloadImages(input.images, tempDirectory);
        }
        context = await openContext();

        const deadline = new Promise((_, reject) => {
            deadlineTimer = setTimeout(
                () => reject(new StepError('timeout')),
                mode === 'login' || mode === 'learn'
                    ? LIMITS.loginDeadlineMs + 30_000
                    : LIMITS.postDeadlineMs,
            );
        });
        const work =
            mode === 'login'
                ? runLogin(context)
                : mode === 'check'
                  ? runCheck(context)
                  : mode === 'session'
                    ? runSession(context)
                    : mode === 'cookie'
                      ? runCookie(context)
                      : mode === 'learn'
                        ? runLearn(context)
                        : mode === 'groups'
                          ? runGroups(context)
                          : runPost(context, input, files);
        const result = await Promise.race([work, deadline]);

        emit(result);
        return 0;
    } catch (error) {
        const code = error instanceof StepError ? error.code : 'unknown';
        emit(
            (mode === 'check' || mode === 'session') && code === 'not_logged_in'
                ? { ok: true, loggedIn: false }
                : { ok: false, error: code },
        );
        return ERROR_EXIT_CODES[code] ?? ERROR_EXIT_CODES.unknown;
    } finally {
        clearTimeout(deadlineTimer);
        if (tempDirectory !== null) {
            fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
        await context?.close().catch(() => undefined);
    }
}

process.exitCode = await main();
