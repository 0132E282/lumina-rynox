#!/usr/bin/env node
// Posts text (optionally with images, no video) to the user's own Facebook timeline by driving a REAL, visible Chrome with a dedicated persistent profile.
// Runs on the user's machine only. Plain Playwright: no stealth plugins, no fingerprint/header/webdriver tweaks, no proxy
// or captcha tricks. A checkpoint/captcha is never bypassed: the script stops with `checkpoint` and the human solves it.
//
// Usage:
//   node scripts/facebook-post.mjs login   # human logs in manually in the opened window
//   node scripts/facebook-post.mjs groups  # read-only: prints {"ok":true,"groups":[{id,name,url}]} of the groups the account joined
//   node scripts/facebook-post.mjs check   # prints {"ok":true,"loggedIn":bool}
//   node scripts/facebook-post.mjs session # login check; refreshes the saved session (cookie header + tokens) for Laravel
//   echo '{"text":"...","audience":"self","images":["https://..."]}' | node scripts/facebook-post.mjs post
//
// Output: exactly one JSON line on stdout, only fixed error codes (never page content, cookies or profile data).
// Session file (storage/app/facebook-session.json, 0600, gitignored, never printed or logged): cookie header, tokens and the request
// template. `session` and `post` refresh the tokens; Laravel's own HTTP tier posts text-only posts with it and only runs this script
// when that is definitively rejected. Here a text-only post first replays the composer's GraphQL request INSIDE the logged-in page
// (`via: "browser-api"`); only a DEFINITIVE rejection falls back, once, to the UI (`via: "ui"`). Any ambiguous API result is `unknown`
// and never retried. Posts with images and the first post (no template yet) use the UI, which also captures the template.
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

// ! Every selector/text Facebook can change lives here (Vietnamese + English). Fix a break in this block only.
const FACEBOOK = {
    groupsUrl: 'https://www.facebook.com/groups/joins/',
    // * Group links look like /groups/<id>/; anything else under /groups/ (feed, discover, joins, create...) is not a group.
    groupPath: /^\/groups\/([A-Za-z0-9.]{3,100})\/?$/,
    // * Pages under /groups/ that look like a group id but are Facebook's own screens.
    groupReserved: new Set([
        'feed',
        'joins',
        'discover',
        'create',
        'search',
        'notifications',
    ]),
    // * Group posting (bulk). ALL UNVERIFIED against the live site: the group page's own composer trigger/textbox wording.
    groupPostUrl:
        /^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9.]{3,100}\/?$/,
    groupComposerTrigger:
        /viết gì đó|bạn viết gì đi|write something|create a public post|tạo bài viết công khai/i,
    groupComposerTextbox:
        /viết gì đó|bạn viết gì đi|write something|tạo bài viết công khai|create a public post/i,
    groupLinkLabel: /^(xem nhóm|view group|vào nhóm|join|tham gia)$/i,
    homeUrl: 'https://www.facebook.com/',
    loginSessionCookie: 'c_user', // * only its presence is tested, the value is never read or printed
    checkpointUrl:
        /\/(checkpoint|two_step_verification|login\/identify|recover)\b|captcha/i,
    checkpointText:
        /xác nhận bạn là người thật|confirm you(?:'|’)re human|security check|kiểm tra bảo mật/i,
    composerTrigger: /bạn đang nghĩ gì|what(?:'|’)s on your mind/i,
    composerTextbox:
        /bạn đang nghĩ gì|what(?:'|’)s on your mind|tạo bài viết công khai|create a public post/i,
    audienceButton:
        /chỉnh sửa quyền riêng tư|edit privacy|chọn đối tượng|select audience|chỉ mình tôi|only me|bạn bè|friends|công khai|public/i,
    // * The audience button reads "Đối tượng của bài viết Công khai": the prefix is dropped before the label is compared.
    audienceButtonPrefix:
        /^(đối tượng của bài viết|đối tượng|post audience|audience)\s*/i,
    audienceDone: /^(xong|done|lưu|save)$/i,
    audienceOptions: {
        self: /^(chỉ mình tôi|only me)/i,
        friends: /^(bạn bè|friends)(?!.*(ngoại trừ|except|cụ thể|specific))/i,
        public: /^(công khai|public)/i,
    },
    // * With an image attached the primary button reads "Tiếp" (Next); a final screen then has "Đăng" (Post).
    nextButton: /^(tiếp|next)$/i,
    submitButton: /^(đăng|post)$/i,
    photoButton:
        /ảnh\/video|ảnh hoặc video|photo\/video|photo or video|add photos?\/videos?/i,
    // * Thumbnails are blob: previews (avatars are not); the remove-button of an attachment must be there too.
    attachmentRemove:
        /gỡ ảnh|xóa ảnh|xoá ảnh|gỡ video|remove photo|remove video|remove attachment|remove$/i,
    attachmentImage: 'img[src^="blob:"]',
    publishedToast:
        /đã đăng|bài viết của bạn (?:đã|hiện)|your post is now published|posted/i,
    justNow: /vừa xong|just now/i,
    viewPostLink: /xem bài viết|view post|xem$|^view$/i,
    // * Permalink anchors inside a feed article (personal posts and group posts).
    postPermalink:
        'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]',
    postUrlParams: ['story_fbid', 'id', 'fbid'],
    // * Extraction of the page tokens Laravel's plain GraphQL request needs, and how the composer's own request is recognised.
    dtsgPatterns: [
        /"DTSGInitialData"[^}]*?"token":"([^"]+)"/,
        /name="fb_dtsg" value="([^"]+)"/,
    ],
    lsdPatterns: [/"LSD"[^}]*?"token":"([^"]+)"/, /name="lsd" value="([^"]+)"/],
    jazoestPattern: /name="jazoest" value="(\d+)"/,
    graphqlPath: '/api/graphql',
    composerFriendlyName: /ComposerStoryCreate/i,
    docIdPattern: /^\d{5,30}$/,
    // * The request the "my groups" page sends for each further page of joined groups; Laravel replays it over HTTP.
    groupsFriendlyName: /^GroupsCometAllJoinedGroupsSectionPaginationQuery$/,
    // * Left out of the saved groups template: tokens come from the session, the cursor from each page's reply.
    groupsTemplateSkip: [
        'fb_dtsg',
        'lsd',
        'jazoest',
        'variables',
        'av',
        '__user',
    ],
    // * In-browser API replay. Params re-read from the live page every time (never stored in the template).
    apiPath: '/api/graphql/',
    volatileParams: [
        'fb_dtsg',
        'lsd',
        'jazoest',
        '__user',
        'av',
        'variables',
        '__req',
    ],
    apiPrivacy: { self: 'SELF', friends: 'FRIENDS', public: 'EVERYONE' },
    uuidPattern:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    // * Keys whose non-empty value ties a template to one specific post (link preview/media/mention offsets): never templated.
    unsafeVariableKeys: /^(attachments?|ranges)$/i,
    postIdKeys: ['post_id', 'legacy_story_hideable_id'],
    postIdPattern: /^[A-Za-z0-9_=-]{1,100}$/,
};

const LIMITS = {
    groupScrollRounds: 30,
    groupsMax: 200,
    groupNameMax: 150,
    textMaxLength: 3000,
    typingDelayMs: 25,
    stepTimeoutMs: 20_000,
    confirmTimeoutMs: 45_000,
    imageMaxBytes: 10 * 1024 * 1024,
    imageDownloadTimeoutMs: 20_000,
    imageMaxCount: 10, // * keep in sync with Post::MAX_MEDIA
    imageUploadTimeoutMs: 40_000,
    apiRequestTimeoutMs: 30_000,
    // * One group post (open the group, type, submit) must finish within 30 s; a slower run ends as a timeout.
    groupPostDeadlineMs: 30_000,
    postDeadlineMs: 150_000, // * below the 180 s the Laravel side allows
    loginDeadlineMs: 10 * 60_000,
    loginPollMs: 2_000,
};

const PROFILE_DIRECTORY = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'storage',
    'app',
    'facebook-profile',
);

const SESSION_FILE = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'storage',
    'app',
    'facebook-session.json',
);

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
    const audience = input?.audience ?? 'self';

    if (
        text === '' ||
        text.length > LIMITS.textMaxLength ||
        !Object.hasOwn(FACEBOOK.audienceOptions, audience)
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

// * Optional `group_url` (bulk group posting): only a group page of facebook.com is accepted, anything else is invalid input.
function parseGroupUrl(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string' || !FACEBOOK.groupPostUrl.test(value)) {
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
                process.env.FACEBOOK_HEADLESS === '1' &&
                process.argv[2] !== 'login',
        });
    } catch {
        // ! The launch error can name local paths: only the fixed code leaves this script.
        throw new StepError('browser_unavailable');
    }
}

async function hasSession(context) {
    const cookies = await context.cookies(FACEBOOK.homeUrl);
    return cookies.some(
        (cookie) => cookie.name === FACEBOOK.loginSessionCookie,
    );
}

async function isCheckpoint(page) {
    if (FACEBOOK.checkpointUrl.test(page.url())) {
        return true;
    }
    return page
        .getByText(FACEBOOK.checkpointText)
        .first()
        .isVisible()
        .catch(() => false);
}

async function openHome(context) {
    const page = context.pages()[0] ?? (await context.newPage());
    try {
        await page.goto(FACEBOOK.homeUrl, {
            waitUntil: 'domcontentloaded',
            timeout: LIMITS.stepTimeoutMs,
        });
    } catch {
        throw new StepError('timeout');
    }
    return page;
}

async function runLogin(context) {
    const page = await openHome(context);
    const deadline = Date.now() + LIMITS.loginDeadlineMs;

    while (Date.now() < deadline) {
        if (await hasSession(context)) {
            await sleep(3_000); // * let the browser persist the session into the profile before closing
            return { ok: true, loggedIn: true };
        }
        if (page.isClosed()) {
            throw new StepError('not_logged_in');
        }
        await sleep(LIMITS.loginPollMs);
    }

    throw new StepError('timeout');
}

async function runCheck(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page)) {
        throw new StepError('checkpoint');
    }

    return { ok: true, loggedIn: await hasSession(context) };
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
            (FACEBOOK.unsafeVariableKeys.test(key) &&
                (Array.isArray(item)
                    ? item.length > 0
                    : isPlainObject(item) && Object.keys(item).length > 0)) ||
            hasUnsafeField(item),
    );
}

const SESSION_KEYS = [
    'user_id',
    'fb_dtsg',
    'lsd',
    'jazoest',
    'cookie_header',
    'template',
    'groups_template',
];

function readSessionFile() {
    try {
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
        return isPlainObject(data) ? data : {};
    } catch {
        return {};
    }
}

// ! Holds live credentials (cookie header, tokens) for Laravel's own HTTP tier: 0600, gitignored, never printed or logged.
// * Merges `patch` into the known keys only, so unknown/legacy keys are dropped.
function writeSessionFile(patch) {
    const merged = { ...readSessionFile(), ...patch };
    const data = Object.fromEntries(
        SESSION_KEYS.filter((key) => merged[key] !== undefined).map((key) => [
            key,
            merged[key],
        ]),
    );
    fs.writeFileSync(
        SESSION_FILE,
        JSON.stringify({ ...data, saved_at: new Date().toISOString() }),
        { mode: 0o600 },
    );
    fs.chmodSync(SESSION_FILE, 0o600);
}

function writeTemplate(template) {
    writeSessionFile({ template });
}

// * Persists the page tokens just read from the live session (best effort: a failure never changes a post outcome).
function saveTokens(tokens) {
    if (tokens === null) {
        return;
    }
    try {
        writeSessionFile({
            user_id: tokens.userId,
            fb_dtsg: tokens.dtsg,
            lsd: tokens.lsd,
            jazoest: tokens.jazoest,
            cookie_header: tokens.cookieHeader,
        });
    } catch {
        // * Laravel's HTTP tier then simply has no fresh session and the browser path runs.
    }
}

// * Returns the saved template only when it is complete; anything doubtful is "no template" (the UI path then runs).
function readTemplate() {
    try {
        const template = readSessionFile().template;
        if (
            !isPlainObject(template) ||
            !isPlainObject(template.params) ||
            !isPlainObject(template.variables) ||
            !Object.values(template.params).every(
                (value) => typeof value === 'string',
            ) ||
            !FACEBOOK.docIdPattern.test(template.params.doc_id ?? '')
        ) {
            return null;
        }
        const serialized = JSON.stringify(template.variables);
        return serialized.includes('"{{text}}"') &&
            serialized.includes('"{{privacy}}"')
            ? template
            : null;
    } catch {
        return null;
    }
}

function discardTemplate() {
    try {
        writeTemplate(null);
    } catch {
        // * Failing to drop a stale template only costs one more rejected attempt later.
    }
}

function firstMatch(text, patterns) {
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match) {
            return match[1];
        }
    }
    return null;
}

// * Reads the tokens from the real logged-in page, each time. Returns null (never throws) when the page did not expose them.
async function readPageTokens(context, page) {
    try {
        const cookies = await context.cookies(FACEBOOK.homeUrl);
        const userId = cookies.find(
            (cookie) => cookie.name === FACEBOOK.loginSessionCookie,
        )?.value;
        const html = await page.content();
        const dtsg = firstMatch(html, FACEBOOK.dtsgPatterns);
        const lsd = firstMatch(html, FACEBOOK.lsdPatterns);

        if (!userId || !dtsg || !lsd) {
            return null;
        }

        const jazoest =
            firstMatch(html, [FACEBOOK.jazoestPattern]) ??
            `2${[...dtsg].reduce((sum, character) => sum + character.charCodeAt(0), 0)}`;

        return {
            userId,
            dtsg,
            lsd,
            jazoest,
            cookieHeader: cookies
                .map((cookie) => `${cookie.name}=${cookie.value}`)
                .join('; '),
        };
    } catch {
        return null;
    }
}

// * Turns the composer's real request into a template: the typed text, the audience state, the account id and UUID-like ids
// * (client mutation/composer session ids, found by shape) become placeholders; token params are dropped. Returns null when the
// * text or audience cannot be found by value, or the request carries attachments/mention ranges (not safe to replay with other text).
function buildTemplate(postData, { text, audience, userId }) {
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
        hasUnsafeField(variables)
    ) {
        return null;
    }

    const privacy = FACEBOOK.apiPrivacy[audience];
    const found = { text: 0, privacy: 0 };
    const uuids = new Map();
    const templated = mapStrings(variables, (value) => {
        if (value === text) {
            found.text += 1;
            return '{{text}}';
        }
        if (value === privacy) {
            found.privacy += 1;
            return '{{privacy}}';
        }
        if (userId && value === userId) {
            return '{{user}}';
        }
        if (FACEBOOK.uuidPattern.test(value)) {
            if (!uuids.has(value)) {
                uuids.set(value, uuids.size);
            }
            return `{{uuid:${uuids.get(value)}}}`;
        }
        return value;
    });
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

function renderTemplate(template, input, tokens) {
    const privacy = FACEBOOK.apiPrivacy[input.audience] ?? 'SELF';
    const uuids = new Map();
    const variables = mapStrings(template.variables, (value) => {
        switch (value) {
            case '{{text}}':
                return input.text;
            case '{{privacy}}':
                return privacy;
            case '{{user}}':
                return tokens.userId;
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

    const body = new URLSearchParams(template.params);
    body.set('av', tokens.userId);
    body.set('__user', tokens.userId);
    body.set('fb_dtsg', tokens.dtsg);
    body.set('lsd', tokens.lsd);
    body.set('jazoest', tokens.jazoest);
    body.set('variables', JSON.stringify(variables));
    return body;
}

function findPostId(value) {
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

// * 'ok' (post id found), 'rejected' (provably not posted: 4xx, or only `errors` without data) or 'unknown' (may have posted).
function classifyApiReply(status, text) {
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

// * Remembers the page's own "next page of joined groups" request as a replay template (params without tokens, variables without
// * the cursor). Nothing is sent or altered; Laravel replays it with the saved session, so sync needs no browser.
function watchGroupsRequest(page) {
    const captured = { template: null };
    page.on('request', (request) => {
        try {
            if (
                request.method() !== 'POST' ||
                !request.url().includes(FACEBOOK.graphqlPath)
            ) {
                return;
            }
            const params = new URLSearchParams(request.postData() ?? '');
            if (
                !FACEBOOK.groupsFriendlyName.test(
                    params.get('fb_api_req_friendly_name') ?? '',
                ) ||
                !FACEBOOK.docIdPattern.test(params.get('doc_id') ?? '')
            ) {
                return;
            }
            const variables = JSON.parse(params.get('variables') ?? '');
            if (!isPlainObject(variables)) {
                return;
            }
            delete variables.cursor;
            captured.template = {
                params: Object.fromEntries(
                    [...params.entries()].filter(
                        ([key]) => !FACEBOOK.groupsTemplateSkip.includes(key),
                    ),
                ),
                variables,
            };
        } catch {
            // * An unreadable request body is simply not the groups request.
        }
    });
    return captured;
}

// * Passive: keeps the groups that appear in the page's own GraphQL responses while the "my groups" page loads and scrolls.
// * Nothing is requested or altered; responses that are not JSON or carry no `Group` node are ignored.
function watchGroupResponses(page) {
    const found = new Map();
    const visit = (node, depth) => {
        if (node === null || typeof node !== 'object' || depth > 40) {
            return;
        }
        if (Array.isArray(node)) {
            for (const child of node) {
                visit(child, depth + 1);
            }
            return;
        }
        if (
            node.__typename === 'Group' &&
            !FACEBOOK.groupReserved.has(node.id) &&
            typeof node.id === 'string' &&
            typeof node.name === 'string' &&
            /^[A-Za-z0-9.]{3,100}$/.test(node.id) &&
            node.name.trim() !== ''
        ) {
            const picture =
                node.profile_picture?.uri ??
                node.group_profile_picture?.uri ??
                node.cover_photo?.photo?.image?.uri;
            found.set(node.id, {
                id: node.id,
                name: node.name.trim().slice(0, LIMITS.groupNameMax),
                url: `https://www.facebook.com/groups/${node.id}/`,
                image: typeof picture === 'string' ? picture : '',
            });
        }
        for (const child of Object.values(node)) {
            visit(child, depth + 1);
        }
    };
    page.on('response', async (response) => {
        try {
            if (!response.url().includes(FACEBOOK.graphqlPath)) {
                return;
            }
            // * A GraphQL reply may be several JSON documents, one per line.
            for (const line of (await response.text()).split('\n')) {
                if (line.trim().startsWith('{')) {
                    visit(JSON.parse(line), 0);
                }
            }
        } catch {
            // * An unreadable or non-JSON reply holds no groups.
        }
    });
    return found;
}

// * Read-only: scrolls the "my groups" page and collects id, name and link of each group. Nothing is clicked, joined or posted.
async function runGroups(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page)) {
        throw new StepError('checkpoint');
    }
    if (!(await hasSession(context))) {
        throw new StepError('not_logged_in');
    }

    const fromApi = watchGroupResponses(page);
    const groupsRequest = watchGroupsRequest(page);

    try {
        await page.goto(FACEBOOK.groupsUrl, {
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
        round < LIMITS.groupScrollRounds && idleRounds < 4;
        round += 1
    ) {
        const links = await page
            .evaluate(() =>
                [...document.querySelectorAll('a[href*="/groups/"]')].map(
                    (anchor) => {
                        // * The picture sits in the same row as the link: climb until the row would hold another group.
                        const idOf = (href) =>
                            /\/groups\/([A-Za-z0-9.]{3,100})\/?$/.exec(
                                new URL(href, location.origin).pathname,
                            )?.[1];
                        const own = idOf(anchor.href);
                        let image = anchor.querySelector('img')?.src ?? '';
                        let row = anchor;
                        for (
                            let depth = 0;
                            image === '' && depth < 5;
                            depth += 1
                        ) {
                            row = row.parentElement;
                            if (row === null) {
                                break;
                            }
                            const ids = new Set(
                                [...row.querySelectorAll('a[href*="/groups/"]')]
                                    .map((link) => idOf(link.href))
                                    .filter(Boolean),
                            );
                            if (ids.size > 1 || (own && !ids.has(own))) {
                                break;
                            }
                            image = row.querySelector('img')?.src ?? '';
                        }

                        return {
                            href: anchor.href,
                            text: (
                                anchor.innerText ||
                                anchor.getAttribute('aria-label') ||
                                ''
                            ).trim(),
                            image,
                        };
                    },
                ),
            )
            .catch(() => []);

        const before = groups.size + fromApi.size;
        for (const link of links) {
            let url;
            try {
                url = new URL(link.href);
            } catch {
                continue;
            }
            const match = FACEBOOK.groupPath.exec(url.pathname);
            if (
                url.hostname !== 'www.facebook.com' ||
                match === null ||
                FACEBOOK.groupReserved.has(match[1])
            ) {
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
                (previous.name === '' && name !== '') ||
                (previous.image === '' && link.image !== '')
            ) {
                groups.set(match[1], {
                    id: match[1],
                    name: FACEBOOK.groupLinkLabel.test(name)
                        ? (previous?.name ?? '')
                        : name || (previous?.name ?? ''),
                    url: `https://www.facebook.com/groups/${match[1]}/`,
                    image: link.image || (previous?.image ?? ''),
                });
            }
        }

        // * Replies land a moment after the scroll: the count is taken after the wait below on the next round.
        idleRounds = groups.size + fromApi.size === before ? idleRounds + 1 : 0;
        await page.mouse.wheel(0, 2500);
        await sleep(1_200);
    }

    // * Saved for Laravel's HTTP sync (best effort): the replay template plus the tokens just read from the live session.
    if (groupsRequest.template !== null) {
        try {
            saveTokens(await readPageTokens(context, page));
            writeSessionFile({ groups_template: groupsRequest.template });
        } catch {
            // * Without it Laravel simply asks for a refresh later.
        }
    }

    // * API groups carry exact names; links found only on the page fill the gaps.
    const merged = new Map(groups);
    for (const [id, group] of fromApi) {
        merged.set(id, {
            ...group,
            image: group.image || (groups.get(id)?.image ?? ''),
        });
    }

    return {
        ok: true,
        groups: [...merged.values()]
            .filter((group) => group.name !== '')
            .slice(0, LIMITS.groupsMax),
    };
}

async function runSession(context) {
    const page = await openHome(context);

    if (await isCheckpoint(page)) {
        throw new StepError('checkpoint');
    }
    if (!(await hasSession(context))) {
        return { ok: true, loggedIn: false };
    }

    const tokens = await readPageTokens(context, page);
    saveTokens(tokens);

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
    return text.replace(FACEBOOK.audienceButtonPrefix, '').trim();
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

function cleanPostUrl(href) {
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
    const snippet = text
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '')
        ?.slice(0, 40);
    const fresh = snippet
        ? page
              .getByRole('article')
              .filter({ hasText: snippet })
              .filter({ hasText: FACEBOOK.justNow })
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

    let href =
        proof === 'notice'
            ? await notice
                  .getByRole('link', { name: FACEBOOK.viewPostLink })
                  .first()
                  .getAttribute('href', { timeout: 2_000 })
                  .catch(() => null)
            : null;

    // * The notice often has no link (group posts): the fresh post's own permalink in the feed is the next best source.
    if (!href && fresh !== null) {
        href = await fresh
            .locator(FACEBOOK.postPermalink)
            .first()
            .getAttribute('href', { timeout: 3_000 })
            .catch(() => null);
    }

    return {
        ok: true,
        via: 'ui',
        url: href ? (cleanPostUrl(href) ?? undefined) : undefined,
    };
}

async function runPost(context, input, files) {
    const page = await openHome(context);

    if (await isCheckpoint(page)) {
        throw new StepError('checkpoint');
    }
    if (!(await hasSession(context))) {
        throw new StepError('not_logged_in');
    }

    if (input.groupUrl !== null) {
        return runGroupPost(page, input, files);
    }

    const tokens = await readPageTokens(context, page);
    saveTokens(tokens);
    const textOnly = files.length === 0;
    let capture = { template: null };

    try {
        const template = textOnly && tokens !== null ? readTemplate() : null;
        if (template !== null) {
            const viaApi = await postThroughApi(page, template, input, tokens);
            if (viaApi !== null) {
                return viaApi;
            }
            // * Definitively rejected (stale template): drop it, the UI post below captures a fresh one.
            discardTemplate();
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
                writeTemplate(capture.template);
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
    await typeText(page, textbox, input.text);
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

// ===== Group posting (bulk, ADDITIVE): one post into one saved group through the group page's own composer. =====
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

    if (await isCheckpoint(page)) {
        throw new StepError('checkpoint');
    }

    let dialog;
    let textbox;
    try {
        await page
            .getByRole('button', { name: FACEBOOK.groupComposerTrigger })
            .first()
            .click({ timeout: LIMITS.stepTimeoutMs });
        // * Facebook nests two dialogs here (an unnamed outer one holding the textbox and the post button, and the inner "Tạo bài viết" one): take the outermost dialog that holds a textbox.
        dialog = page
            .getByRole('dialog')
            .filter({ has: page.getByRole('textbox') })
            .first();
        // * The group dialog's textbox may carry no accessible name (the wording is only a placeholder): fall back to the dialog's first textbox.
        textbox = dialog
            .getByRole('textbox', { name: FACEBOOK.groupComposerTextbox })
            .or(dialog.getByRole('textbox'))
            .first();
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

async function main() {
    const mode = process.argv[2];
    if (!['login', 'check', 'session', 'groups', 'post'].includes(mode)) {
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
                path.join(os.tmpdir(), 'facebook-post-'),
            );
            files = await downloadImages(input.images, tempDirectory);
        }
        context = await openContext();

        const deadline = new Promise((_, reject) => {
            deadlineTimer = setTimeout(
                () => reject(new StepError('timeout')),
                mode === 'login'
                    ? LIMITS.loginDeadlineMs + 30_000
                    : input?.groupUrl
                      ? LIMITS.groupPostDeadlineMs
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
