import assert from 'node:assert/strict';
import test from 'node:test';
import { createFacebook, FACEBOOK_MODES } from '../src/facebook/index.mjs';
import { createLinkedin, LINKEDIN_MODES } from '../src/linkedin/index.mjs';
import { FACEBOOK } from '../src/facebook/selectors.mjs';
import { LINKEDIN } from '../src/linkedin/selectors.mjs';

// * Every case below fails input validation, which happens BEFORE any browser launch or download.
const invalid = { ok: false, error: 'invalid_input' };

test('public API surface', () => {
    const facebook = createFacebook();
    const linkedin = createLinkedin();
    for (const name of [
        'login',
        'check',
        'session',
        'groups',
        'post',
        'postToGroup',
    ]) {
        assert.equal(typeof facebook[name], 'function', `facebook.${name}`);
        assert.equal(typeof linkedin[name], 'function', `linkedin.${name}`);
    }
    assert.equal(typeof linkedin.learn, 'function');
    assert.equal('learn' in facebook, false);
    assert.deepEqual(FACEBOOK_MODES, [
        'login',
        'check',
        'session',
        'groups',
        'post',
    ]);
    assert.deepEqual(LINKEDIN_MODES, [
        'login',
        'check',
        'session',
        'learn',
        'groups',
        'post',
    ]);
});

test('postToGroup requires a valid group page of the provider and valid post fields', async () => {
    const facebook = createFacebook();
    const linkedin = createLinkedin();
    assert.deepEqual(await facebook.postToGroup({ text: 'hi' }), invalid);
    assert.deepEqual(await facebook.postToGroup(null), invalid);
    assert.deepEqual(
        await facebook.postToGroup({
            groupUrl: 'https://www.linkedin.com/groups/123456/',
            text: 'hi',
        }),
        invalid,
    );
    assert.deepEqual(
        await facebook.postToGroup({
            groupUrl: 'https://www.facebook.com/groups/abc123/',
            text: '',
        }),
        invalid,
    );
    assert.deepEqual(
        await linkedin.postToGroup({
            groupUrl: 'https://www.linkedin.com/groups/abc/',
            text: 'hi',
        }),
        invalid,
    );
    assert.deepEqual(
        await linkedin.post({
            text: 'hi',
            group_url: 'https://www.facebook.com/groups/abc123/',
        }),
        invalid,
    );
});

test('post rejects bad audience and images before launching anything', async () => {
    assert.deepEqual(
        await createFacebook().post({ text: 'a', audience: 'connections' }),
        invalid,
    );
    assert.deepEqual(
        await createLinkedin().post({ text: 'a', audience: 'self' }),
        invalid,
    );
    assert.deepEqual(
        await createFacebook().post({ text: 'a', images: ['ftp://x/y.png'] }),
        invalid,
    );
});

test('group post URL patterns accept only a bare group page', () => {
    assert.match(
        'https://www.facebook.com/groups/abc.123/',
        FACEBOOK.groupPostUrl,
    );
    assert.doesNotMatch(
        'https://www.facebook.com/groups/abc123/posts/1',
        FACEBOOK.groupPostUrl,
    );
    assert.match(
        'https://www.linkedin.com/groups/123456',
        LINKEDIN.groupPostUrl,
    );
    assert.doesNotMatch(
        'https://www.linkedin.com/groups/abc/',
        LINKEDIN.groupPostUrl,
    );
});
