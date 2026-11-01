import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage } from '../src/normalize.mjs';

const base = {
    msgId: '9001',
    uidFrom: '2002',
    dName: 'An',
    ts: '1700000000000',
    content: 'xin chào',
    msgType: 'webchat',
};

test('tin cá nhân dạng text', () => {
    const result = normalizeMessage(
        { type: 0, threadId: '2002', isSelf: false, data: base },
        '1001',
    );
    assert.deepEqual(result, {
        message_id: '9001',
        thread_id: '2002',
        thread_type: 'user',
        thread_name: null,
        sender_id: '2002',
        sender_name: 'An',
        is_self: false,
        content_type: 'text',
        text: 'xin chào',
        mentions_self: false,
        sent_at_ms: 1700000000000,
    });
});

test('tin nhóm có mention chính mình', () => {
    const message = {
        type: 1,
        threadId: 'g1',
        isSelf: false,
        data: {
            ...base,
            mentions: [
                { uid: '3', pos: 0, len: 2, type: 0 },
                { uid: '1001', pos: 3, len: 2, type: 0 },
            ],
        },
    };
    const result = normalizeMessage(message, '1001');
    assert.equal(result.thread_type, 'group');
    assert.equal(result.mentions_self, true);
});

test('tin nhóm mention người khác hoặc tin cá nhân: mentions_self=false', () => {
    const group = {
        type: 1,
        threadId: 'g1',
        isSelf: false,
        data: { ...base, mentions: [{ uid: '3', pos: 0, len: 2, type: 0 }] },
    };
    assert.equal(normalizeMessage(group, '1001').mentions_self, false);
    const user = {
        type: 0,
        threadId: '2002',
        isSelf: false,
        data: { ...base, mentions: [{ uid: '1001' }] },
    };
    assert.equal(normalizeMessage(user, '1001').mentions_self, false);
});

test('isSelf được giữ nguyên', () => {
    assert.equal(
        normalizeMessage(
            { type: 0, threadId: '2002', isSelf: true, data: base },
            '1001',
        ).is_self,
        true,
    );
});

test('nội dung không phải text: text=null và content_type theo msgType, lạ thì other', () => {
    const photo = normalizeMessage(
        {
            type: 0,
            threadId: '2',
            isSelf: false,
            data: { ...base, content: { href: 'x' }, msgType: 'chat.photo' },
        },
        '1',
    );
    assert.equal(photo.content_type, 'image');
    assert.equal(photo.text, null);
    const unknown = normalizeMessage(
        {
            type: 0,
            threadId: '2',
            isSelf: false,
            data: { ...base, content: { a: 1 }, msgType: 'zzz' },
        },
        '1',
    );
    assert.equal(unknown.content_type, 'other');
});

test('thiếu msgId hoặc threadId thì trả null', () => {
    assert.equal(
        normalizeMessage(
            { type: 0, threadId: '2', data: { ...base, msgId: undefined } },
            '1',
        ),
        null,
    );
    assert.equal(
        normalizeMessage({ type: 0, threadId: '', data: base }, '1'),
        null,
    );
    assert.equal(normalizeMessage(null, '1'), null);
});
