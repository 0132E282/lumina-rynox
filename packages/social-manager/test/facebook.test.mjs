import assert from 'node:assert/strict';
import test from 'node:test';
import {
    audienceLabel,
    buildTemplate,
    classifyApiReply,
    cleanPostUrl,
    extractTokens,
    findPostId,
    isUsableTemplate,
    renderTemplate,
} from '../src/facebook/template.mjs';

const UUID = '11111111-1111-4111-8111-111111111111';

function composerBody(variables, extra = {}) {
    return new URLSearchParams({
        doc_id: '1234567890',
        fb_api_req_friendly_name: 'ComposerStoryCreateMutation',
        fb_dtsg: 'SECRET',
        lsd: 'LSD',
        jazoest: '2999',
        __user: '100',
        av: '100',
        __req: '1c',
        __a: '1',
        variables: JSON.stringify(variables),
        ...extra,
    }).toString();
}

const sampleVariables = {
    input: {
        message: { text: 'hello world', ranges: [] },
        audience: { privacy: { base_state: 'SELF' } },
        actor_id: '100',
        client_mutation_id: UUID,
        composer_session_id: UUID,
        attachments: [],
    },
};

test('buildTemplate anchors text, privacy, user and uuids; drops volatile params', () => {
    const template = buildTemplate(composerBody(sampleVariables), {
        text: 'hello world',
        audience: 'self',
        userId: '100',
    });
    assert.deepEqual(template.variables.input.message.text, '{{text}}');
    assert.equal(
        template.variables.input.audience.privacy.base_state,
        '{{privacy}}',
    );
    assert.equal(template.variables.input.actor_id, '{{user}}');
    assert.equal(template.variables.input.client_mutation_id, '{{uuid:0}}');
    assert.equal(template.variables.input.composer_session_id, '{{uuid:0}}');
    for (const key of [
        'fb_dtsg',
        'lsd',
        'jazoest',
        '__user',
        'av',
        '__req',
        'variables',
    ]) {
        assert.equal(key in template.params, false, key);
    }
    assert.equal(template.params.doc_id, '1234567890');
    assert.equal(template.params.__a, '1');
    assert.equal(isUsableTemplate(template), true);
});

test('buildTemplate refuses unanchored, unsafe or malformed requests', () => {
    const ctx = { text: 'hello world', audience: 'self', userId: '100' };
    assert.equal(
        buildTemplate(composerBody(sampleVariables), { ...ctx, text: 'other' }),
        null,
    );
    assert.equal(
        buildTemplate(composerBody(sampleVariables), {
            ...ctx,
            audience: 'public',
        }),
        null,
    );
    const withAttachment = structuredClone(sampleVariables);
    withAttachment.input.attachments = [{ photo: { id: '1' } }];
    assert.equal(buildTemplate(composerBody(withAttachment), ctx), null);
    assert.equal(
        buildTemplate(composerBody(sampleVariables, { doc_id: 'abc' }), ctx),
        null,
    );
    assert.equal(
        buildTemplate('variables=notjson&doc_id=1234567890', ctx),
        null,
    );
    assert.equal(buildTemplate('', ctx), null);
});

test('isUsableTemplate rejects incomplete templates', () => {
    assert.equal(isUsableTemplate(null), false);
    assert.equal(
        isUsableTemplate({
            params: { doc_id: '1234567' },
            variables: { a: '{{text}}' },
        }),
        false,
    );
    assert.equal(
        isUsableTemplate({
            params: { doc_id: 'x' },
            variables: { a: '{{text}}', b: '{{privacy}}' },
        }),
        false,
    );
    assert.equal(
        isUsableTemplate({
            params: { doc_id: '1234567', n: 1 },
            variables: { a: '{{text}}', b: '{{privacy}}' },
        }),
        false,
    );
    assert.equal(
        isUsableTemplate({
            params: { doc_id: '1234567' },
            variables: { a: '{{text}}', b: '{{privacy}}' },
        }),
        true,
    );
});

test('renderTemplate substitutes text, privacy mapping, tokens and fresh uuids', () => {
    const template = buildTemplate(composerBody(sampleVariables), {
        text: 'hello world',
        audience: 'self',
        userId: '100',
    });
    const tokens = { userId: '555', dtsg: 'D', lsd: 'L', jazoest: 'J' };
    const body = renderTemplate(
        template,
        { text: 'new "text"\nline', audience: 'public' },
        tokens,
    );
    const variables = JSON.parse(body.get('variables'));
    assert.equal(variables.input.message.text, 'new "text"\nline');
    assert.equal(variables.input.audience.privacy.base_state, 'EVERYONE');
    assert.equal(variables.input.actor_id, '555');
    assert.notEqual(variables.input.client_mutation_id, UUID);
    assert.equal(
        variables.input.client_mutation_id,
        variables.input.composer_session_id,
    );
    assert.equal(body.get('fb_dtsg'), 'D');
    assert.equal(body.get('lsd'), 'L');
    assert.equal(body.get('jazoest'), 'J');
    assert.equal(body.get('av'), '555');
    assert.equal(body.get('__user'), '555');
    // an unknown audience falls back to the safest one
    const unknown = renderTemplate(
        template,
        { text: 'a', audience: 'weird' },
        tokens,
    );
    assert.equal(
        JSON.parse(unknown.get('variables')).input.audience.privacy.base_state,
        'SELF',
    );
});

test('extractTokens reads tokens and computes jazoest when absent', () => {
    const html =
        '..."DTSGInitialData",[],{"token":"AbC"}... "LSD",[],{"token":"lsdTok"} <input name="jazoest" value="2345">';
    assert.deepEqual(extractTokens(html, '100'), {
        userId: '100',
        dtsg: 'AbC',
        lsd: 'lsdTok',
        jazoest: '2345',
    });
    const noJazoest = extractTokens(
        'name="fb_dtsg" value="ab" name="lsd" value="q"',
        '1',
    );
    assert.equal(
        noJazoest.jazoest,
        `2${'a'.charCodeAt(0) + 'b'.charCodeAt(0)}`,
    );
    assert.equal(extractTokens(html, undefined), null);
    assert.equal(extractTokens('nothing', '1'), null);
});

test('findPostId finds the id in nested data', () => {
    assert.equal(findPostId({ data: [{ x: { post_id: '123_4' } }] }), '123_4');
    assert.equal(findPostId({ post_id: 'bad id!' }), null);
    assert.equal(findPostId('x'), null);
});

test('classifyApiReply: ok / rejected / unknown never mixed up', () => {
    const ok = JSON.stringify({
        data: {
            story_create: { story: { legacy_story_hideable_id: '987654' } },
        },
    });
    assert.deepEqual(classifyApiReply(200, `for (;;);${ok}`), {
        kind: 'ok',
        postId: '987654',
    });
    assert.deepEqual(
        classifyApiReply(200, `${JSON.stringify({ errors: [{}] })}\n${ok}`),
        { kind: 'ok', postId: '987654' },
    );
    // 5xx and ambiguous replies may have posted: unknown, never rejected
    assert.equal(classifyApiReply(500, '').kind, 'unknown');
    assert.equal(classifyApiReply(503, ok).kind, 'unknown');
    assert.equal(classifyApiReply(200, '').kind, 'unknown');
    assert.equal(classifyApiReply(200, 'not json').kind, 'unknown');
    assert.equal(
        classifyApiReply(200, JSON.stringify({ data: { x: 1 } })).kind,
        'unknown',
    );
    assert.equal(
        classifyApiReply(200, JSON.stringify({ data: {}, errors: [{}] })).kind,
        'unknown',
    );
    assert.equal(
        classifyApiReply(200, JSON.stringify({ foo: 1 })).kind,
        'unknown',
    );
    // definitive rejections
    assert.equal(classifyApiReply(400, '').kind, 'rejected');
    assert.equal(classifyApiReply(403, ok).kind, 'rejected');
    assert.equal(
        classifyApiReply(200, JSON.stringify({ errors: [{ message: 'x' }] }))
            .kind,
        'rejected',
    );
});

test('audienceLabel strips the prefix; cleanPostUrl keeps only safe parts', () => {
    assert.equal(
        audienceLabel('Đối tượng của bài viết Công khai'),
        'Công khai',
    );
    assert.equal(audienceLabel('Post audience Only me'), 'Only me');
    assert.equal(
        cleanPostUrl('/permalink.php?story_fbid=1&id=2&token=SECRET'),
        'https://www.facebook.com/permalink.php?story_fbid=1&id=2',
    );
    assert.equal(cleanPostUrl('https://evil.example/x'), null);
    assert.equal(
        cleanPostUrl('https://m.facebook.com/p/1?mibextid=x'),
        'https://www.facebook.com/p/1',
    );
});
