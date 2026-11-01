import assert from 'node:assert/strict';
import test from 'node:test';
import {
    audienceLabel,
    buildTemplate,
    classifyApiReply,
    cleanPostUrl,
    findPostUrn,
    isUsableTemplate,
    matchesAudience,
    postUrl,
    renderBody,
    resultFromUrl,
} from '../src/linkedin/template.mjs';

const UUID = '11111111-1111-4111-8111-111111111111';
const URN = 'urn:li:share:7000000000000000001';

function fakeRequest(
    body,
    {
        url = 'https://www.linkedin.com/voyager/api/contentcreation/normShares',
        headers = {},
    } = {},
) {
    return {
        url: () => url,
        postData: () =>
            typeof body === 'string' ? body : JSON.stringify(body),
        headers: () => headers,
    };
}

const sampleBody = {
    visibleToConnectionsOnly: false,
    commentary: { text: 'hello', attributes: [] },
    visibility: 'ANYONE',
    trackingId: UUID,
};

test('buildTemplate anchors text and visibility and keeps replay headers only', () => {
    const template = buildTemplate(
        fakeRequest(sampleBody, {
            headers: {
                'Content-Type': 'application/json',
                Cookie: 'SECRET',
                'csrf-token': 'SECRET',
                'x-li-lang': 'en_US',
            },
        }),
        { text: 'hello', audience: 'public' },
    );
    assert.equal(template.body.commentary.text, '{{text}}');
    assert.equal(template.body.visibility, '{{visibility}}');
    assert.equal(template.body.trackingId, '{{uuid:0}}');
    assert.deepEqual(template.visibility, { public: 'ANYONE' });
    assert.deepEqual(template.headers, {
        'content-type': 'application/json',
        'x-li-lang': 'en_US',
    });
    assert.equal(JSON.stringify(template).includes('SECRET'), false);
    assert.equal(isUsableTemplate(template), true);
});

test('buildTemplate merges the previously observed audiences on the same path only', () => {
    const connections = { ...sampleBody, visibility: 'CONNECTIONS' };
    const previous = {
        path: '/voyager/api/contentcreation/normShares',
        visibility: { public: 'ANYONE' },
    };
    const merged = buildTemplate(
        fakeRequest(connections),
        { text: 'hello', audience: 'connections' },
        previous,
    );
    assert.deepEqual(merged.visibility, {
        public: 'ANYONE',
        connections: 'CONNECTIONS',
    });
    const other = buildTemplate(
        fakeRequest(connections),
        { text: 'hello', audience: 'connections' },
        { ...previous, path: '/voyager/api/other' },
    );
    assert.deepEqual(other.visibility, { connections: 'CONNECTIONS' });
});

test('buildTemplate refuses unanchored, unsafe, malformed or off-path requests', () => {
    const ctx = { text: 'hello', audience: 'public' };
    assert.equal(
        buildTemplate(fakeRequest(sampleBody), { ...ctx, text: 'nope' }),
        null,
    );
    assert.equal(
        buildTemplate(fakeRequest(sampleBody), {
            ...ctx,
            audience: 'connections',
        }),
        null,
    );
    assert.equal(
        buildTemplate(fakeRequest(sampleBody), { ...ctx, audience: 'nobody' }),
        null,
    );
    assert.equal(
        buildTemplate(fakeRequest({ ...sampleBody, media: [{ id: 1 }] }), ctx),
        null,
    );
    assert.equal(
        buildTemplate(
            fakeRequest({ ...sampleBody, mediaCategory: 'IMAGE' }),
            ctx,
        ),
        null,
    );
    assert.equal(
        buildTemplate(
            fakeRequest({
                ...sampleBody,
                commentary: { text: 'hello', attributes: [{ a: 1 }] },
            }),
            ctx,
        ),
        null,
    );
    assert.equal(buildTemplate(fakeRequest('not json'), ctx), null);
    assert.equal(buildTemplate(fakeRequest([1]), ctx), null);
    assert.equal(
        buildTemplate(
            fakeRequest(sampleBody, {
                url: 'https://www.linkedin.com/other/path',
            }),
            ctx,
        ),
        null,
    );
});

test('isUsableTemplate rejects incomplete templates', () => {
    const good = {
        path: '/voyager/api/x',
        headers: {},
        body: { t: '{{text}}', v: '{{visibility}}' },
        visibility: { public: 'ANYONE' },
    };
    assert.equal(isUsableTemplate(good), true);
    assert.equal(isUsableTemplate(null), false);
    assert.equal(isUsableTemplate({ ...good, path: '/not/voyager' }), false);
    assert.equal(isUsableTemplate({ ...good, headers: { a: 1 } }), false);
    assert.equal(
        isUsableTemplate({ ...good, visibility: { public: 1 } }),
        false,
    );
    assert.equal(isUsableTemplate({ ...good, body: { t: '{{text}}' } }), false);
});

test('renderBody fills text, the observed visibility and fresh uuids', () => {
    const template = buildTemplate(fakeRequest(sampleBody), {
        text: 'hello',
        audience: 'public',
    });
    const body = renderBody(template, { text: 'new', audience: 'public' });
    assert.equal(body.commentary.text, 'new');
    assert.equal(body.visibility, 'ANYONE');
    assert.notEqual(body.trackingId, UUID);
    assert.match(body.trackingId, /^[0-9a-f-]{36}$/);
});

test('findPostUrn / postUrl', () => {
    assert.equal(findPostUrn({ a: [{ b: `x ${URN} y` }] }), URN);
    assert.equal(findPostUrn({ a: 'urn:li:share:12' }), null);
    assert.equal(postUrl(URN), `https://www.linkedin.com/feed/update/${URN}/`);
});

test('classifyApiReply: ok / rejected / unknown never mixed up', () => {
    assert.deepEqual(classifyApiReply(201, '', URN), {
        kind: 'ok',
        postId: URN,
    });
    assert.deepEqual(
        classifyApiReply(200, JSON.stringify({ value: { urn: URN } }), null),
        { kind: 'ok', postId: URN },
    );
    // ambiguous: may have posted
    assert.equal(classifyApiReply(500, '', null).kind, 'unknown');
    assert.equal(classifyApiReply(302, '', null).kind, 'unknown');
    assert.equal(classifyApiReply(199, '', null).kind, 'unknown');
    assert.equal(classifyApiReply(200, 'not json', null).kind, 'unknown');
    assert.equal(classifyApiReply(200, '{}', null).kind, 'unknown');
    assert.equal(
        classifyApiReply(200, JSON.stringify({ data: {}, errors: [{}] }), null)
            .kind,
        'unknown',
    );
    assert.equal(
        classifyApiReply(200, JSON.stringify({ errors: [] }), null).kind,
        'unknown',
    );
    // definitive
    assert.equal(classifyApiReply(400, '', null).kind, 'rejected');
    assert.equal(
        classifyApiReply(422, JSON.stringify({ data: {} }), null).kind,
        'rejected',
    );
    assert.equal(
        classifyApiReply(200, JSON.stringify({ errors: [{ m: 1 }] }), null)
            .kind,
        'rejected',
    );
});

test('matchesAudience requires the wanted audience and none other', () => {
    assert.equal(matchesAudience('Mọi người', 'public'), true);
    assert.equal(matchesAudience('Anyone', 'public'), true);
    assert.equal(matchesAudience('Anyone', 'connections'), false);
    assert.equal(matchesAudience('Connections only', 'connections'), true);
    assert.equal(matchesAudience('Chỉ kết nối', 'public'), false);
    assert.equal(matchesAudience('Something else', 'public'), false);
    assert.equal(matchesAudience('', 'connections'), false);
});

test('audienceLabel strips known prefixes', () => {
    assert.equal(audienceLabel('Post settings Anyone'), 'Anyone');
    assert.equal(
        audienceLabel('Who can see your post? Connections only'),
        'Connections only',
    );
});

test('cleanPostUrl / resultFromUrl keep only feed update paths on linkedin.com', () => {
    assert.equal(
        cleanPostUrl(`/feed/update/${URN}/?trk=SECRET`),
        `https://www.linkedin.com/feed/update/${URN}/`,
    );
    assert.equal(cleanPostUrl('https://evil.example/feed/update/x'), null);
    assert.equal(cleanPostUrl('/in/someone'), null);
    assert.deepEqual(resultFromUrl(`/feed/update/${URN}/`), {
        ok: true,
        via: 'ui',
        url: `https://www.linkedin.com/feed/update/${URN}/`,
        post_id: URN,
    });
    assert.deepEqual(resultFromUrl(null), {
        ok: true,
        via: 'ui',
        url: undefined,
        post_id: undefined,
    });
});
