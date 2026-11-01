import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    ERROR_EXIT_CODES,
    StepError,
    exitCodeFor,
} from '../src/shared/errors.mjs';
import { collectGroups } from '../src/shared/groups.mjs';
import { downloadImage } from '../src/shared/images.mjs';
import { hasGroupUrl, parsePostInput } from '../src/shared/input.mjs';
import { runCli } from '../src/shared/cli.mjs';
import { DEFAULT_LIMITS } from '../src/shared/limits.mjs';
import { createSessionStore } from '../src/shared/session-store.mjs';
import {
    hasPlaceholders,
    hasUnsafeField,
    isNonEmptyContainer,
    renderPlaceholders,
    templatizeStrings,
} from '../src/shared/template.mjs';
import { firstLineSnippet, mapStrings } from '../src/shared/util.mjs';

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('exitCodeFor maps fixed codes and falls back to unknown', () => {
    assert.equal(exitCodeFor({ ok: true }), 0);
    assert.equal(exitCodeFor({ ok: false, error: 'checkpoint' }), 13);
    assert.equal(exitCodeFor({ ok: false, error: 'whatever' }), 1);
    assert.equal(new StepError('timeout').code, 'timeout');
    assert.equal(Object.keys(ERROR_EXIT_CODES).length, 10);
});

test('mapStrings transforms values only and keeps shape', () => {
    const out = mapStrings({ a: 'x', b: ['x', 1, null], c: { d: 'y' } }, (v) =>
        v.toUpperCase(),
    );
    assert.deepEqual(out, { a: 'X', b: ['X', 1, null], c: { d: 'Y' } });
});

test('firstLineSnippet skips blank lines and truncates', () => {
    assert.equal(firstLineSnippet('\n  \n  hello world \nx'), 'hello world');
    assert.equal(firstLineSnippet('abcdef', 3), 'abc');
    assert.equal(firstLineSnippet('  \n '), null);
});

test('parsePostInput validates text, audience and images', () => {
    const rules = {
        audienceOptions: { self: 1, public: 1 },
        defaultAudience: 'self',
        groupPostUrl:
            /^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9.]{3,100}\/?$/,
        limits: { textMaxLength: 10, imageMaxCount: 2 },
    };
    assert.deepEqual(parsePostInput({ text: ' a\r\nb ' }, rules), {
        text: 'a\nb',
        audience: 'self',
        images: [],
        groupUrl: null,
    });
    const bad = (input) =>
        assert.throws(
            () => parsePostInput(input, rules),
            (error) =>
                error instanceof StepError && error.code === 'invalid_input',
        );
    bad(null);
    bad({ text: '' });
    bad({ text: 'x'.repeat(11) });
    bad({ text: 'a', audience: 'friends' });
    bad({ text: 'a', audience: 'toString' });
    bad({ text: 'a', images: 'x' });
    bad({ text: 'a', images: ['https://a/1', 'https://a/2', 'https://a/3'] });
    bad({ text: 'a', images: ['ftp://a/1'] });
    bad({ text: 'a', images: ['not a url'] });
    bad({ text: 'a', group_url: 'https://www.facebook.com/groups/feed/x' });
    bad({ text: 'a', group_url: 'http://www.facebook.com/groups/abc123/' });
    bad({ text: 'a', group_url: 'https://evil.example/groups/abc123/' });
    bad({
        text: 'a',
        group_url: 'https://www.facebook.com/groups/abc123/?x=1',
    });
    bad({ text: 'a', group_url: 42 });
    assert.deepEqual(
        parsePostInput({ text: 'a', images: ['https://a/1.png'] }, rules)
            .images,
        ['https://a/1.png'],
    );
});

test('parsePostInput accepts group_url / groupUrl as given; hasGroupUrl detects it', () => {
    const rules = {
        audienceOptions: { public: 1 },
        defaultAudience: 'public',
        groupPostUrl: /^https:\/\/www\.linkedin\.com\/groups\/\d{3,15}\/?$/,
        limits: { textMaxLength: 10, imageMaxCount: 1 },
    };
    const url = 'https://www.linkedin.com/groups/123456/';
    assert.equal(
        parsePostInput({ text: 'a', group_url: url }, rules).groupUrl,
        url,
    );
    assert.equal(
        parsePostInput({ text: 'a', groupUrl: url }, rules).groupUrl,
        url,
    );
    assert.equal(
        parsePostInput({ text: 'a', group_url: null }, rules).groupUrl,
        null,
    );
    assert.equal(hasGroupUrl({ group_url: url }), true);
    assert.equal(hasGroupUrl({ groupUrl: url }), true);
    assert.equal(hasGroupUrl({ text: 'a' }), false);
    assert.equal(hasGroupUrl(null), false);
});

test('templatizeStrings: rules win, then UUIDs get stable indexes', () => {
    const uuidA = '11111111-1111-4111-8111-111111111111';
    const uuidB = '22222222-2222-4222-8222-222222222222';
    const out = templatizeStrings(
        { t: 'hi', ids: [uuidA, uuidB, uuidA], keep: 'z' },
        [(value) => (value === 'hi' ? '{{text}}' : null)],
        UUID_PATTERN,
    );
    assert.deepEqual(out, {
        t: '{{text}}',
        ids: ['{{uuid:0}}', '{{uuid:1}}', '{{uuid:0}}'],
        keep: 'z',
    });
});

test('renderPlaceholders fills values and gives fresh, consistent UUIDs', () => {
    const template = {
        t: '{{text}}',
        ids: ['{{uuid:0}}', '{{uuid:1}}', '{{uuid:0}}'],
    };
    const first = renderPlaceholders(template, { '{{text}}': 'hello' });
    const second = renderPlaceholders(template, { '{{text}}': 'hello' });
    assert.equal(first.t, 'hello');
    assert.match(first.ids[0], UUID_PATTERN);
    assert.equal(first.ids[0], first.ids[2]);
    assert.notEqual(first.ids[0], first.ids[1]);
    assert.notEqual(first.ids[0], second.ids[0]);
});

test('hasUnsafeField / isNonEmptyContainer / hasPlaceholders', () => {
    const unsafe = (key, item) => key === 'media' && isNonEmptyContainer(item);
    assert.equal(hasUnsafeField({ a: { media: [] } }, unsafe), false);
    assert.equal(hasUnsafeField({ a: [{ media: [1] }] }, unsafe), true);
    assert.equal(hasUnsafeField('x', unsafe), false);
    assert.equal(
        hasPlaceholders({ a: '{{text}}', b: '{{v}}' }, ['{{text}}', '{{v}}']),
        true,
    );
    assert.equal(hasPlaceholders({ a: 'x {{text}}' }, ['{{text}}']), false);
});

test('collectGroups keeps only real group links with a name', () => {
    const config = {
        hostname: 'www.facebook.com',
        groupPath: /^\/groups\/([A-Za-z0-9.]{3,100})\/?$/,
        groupLinkLabel: /^(xem nhóm|view group)$/i,
        groupUrl: (id) => `https://www.facebook.com/groups/${id}/`,
        groupNameMax: 10,
    };
    const groups = collectGroups(
        [
            {
                href: 'https://www.facebook.com/groups/abc123/',
                text: 'View group',
            },
            {
                href: 'https://www.facebook.com/groups/abc123/',
                text: 'Cool Group\nmore',
            },
            { href: 'https://www.facebook.com/groups/feed/x', text: 'No' },
            { href: 'https://evil.example/groups/abc123/', text: 'Evil' },
            { href: 'nope', text: 'Bad' },
            {
                href: 'https://www.facebook.com/groups/long999/',
                text: 'A very long group name',
            },
        ],
        config,
    );
    assert.deepEqual(
        [...groups.values()],
        [
            {
                id: 'abc123',
                name: 'Cool Group',
                url: 'https://www.facebook.com/groups/abc123/',
            },
            {
                id: 'long999',
                name: 'A very lon',
                url: 'https://www.facebook.com/groups/long999/',
            },
        ],
    );
});

test('session store merges known keys only, 0600, and removes', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pss-store-'));
    const file = path.join(directory, 'nested', 's.json');
    try {
        const store = createSessionStore(file, ['a', 'template']);
        assert.deepEqual(store.read(), {});
        store.write({ a: 1, junk: 2 });
        store.write({ template: null });
        const data = store.read();
        assert.equal(data.a, 1);
        assert.equal(data.template, null);
        assert.equal('junk' in data, false);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        store.remove();
        assert.deepEqual(store.read(), {});
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('downloadImage accepts images and rejects everything else with the fixed code', async () => {
    const server = http.createServer((request, response) => {
        if (request.url === '/ok.png') {
            response.writeHead(200, { 'content-type': 'image/png' });
            response.end(Buffer.from([1, 2, 3]));
        } else if (request.url === '/html') {
            response.writeHead(200, { 'content-type': 'text/html' });
            response.end('<p>x</p>');
        } else if (request.url === '/big.png') {
            response.writeHead(200, { 'content-type': 'image/png' });
            response.end(Buffer.alloc(50));
        } else {
            response.writeHead(404, { 'content-type': 'image/png' });
            response.end();
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pss-img-'));
    try {
        const file = await downloadImage(`${base}/ok.png`, directory, 0);
        assert.equal(path.basename(file), 'image-0.png');
        assert.deepEqual([...fs.readFileSync(file)], [1, 2, 3]);
        for (const [url, limits] of [
            [`${base}/html`, DEFAULT_LIMITS],
            [`${base}/missing.png`, DEFAULT_LIMITS],
            [`${base}/big.png`, { ...DEFAULT_LIMITS, imageMaxBytes: 10 }],
        ]) {
            await assert.rejects(
                downloadImage(url, directory, 1, limits),
                (error) =>
                    error instanceof StepError &&
                    error.code === 'image_download_failed',
            );
        }
    } finally {
        server.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('runCli: one JSON line, exit code from the result, invalid mode/stdin', async () => {
    const lines = [];
    const write = (line) => lines.push(line);
    const client = {
        check: async () => ({ ok: true, loggedIn: true }),
        post: async (input) => ({ ok: false, error: 'checkpoint', input }),
    };
    const stdinOf = (text) =>
        (async function* () {
            yield Buffer.from(text);
        })();

    assert.equal(
        await runCli({
            client,
            modes: ['check', 'post'],
            mode: 'check',
            write,
        }),
        0,
    );
    assert.equal(lines.pop(), '{"ok":true,"loggedIn":true}\n');

    assert.equal(
        await runCli({ client, modes: ['check'], mode: 'nope', write }),
        14,
    );
    assert.equal(lines.pop(), '{"ok":false,"error":"invalid_input"}\n');

    assert.equal(
        await runCli({
            client,
            modes: ['post'],
            mode: 'post',
            stdin: stdinOf('{bad'),
            write,
        }),
        14,
    );
    assert.equal(lines.pop(), '{"ok":false,"error":"invalid_input"}\n');

    assert.equal(
        await runCli({
            client,
            modes: ['post'],
            mode: 'post',
            stdin: stdinOf('{"text":"a"}'),
            write,
        }),
        13,
    );
    assert.equal(JSON.parse(lines.pop()).input.text, 'a');
    assert.equal(lines.length, 0);
});
