import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchContacts, MAX_FRIENDS, MAX_GROUPS } from '../src/contacts.mjs';
import { BridgeError, ZaloSession } from '../src/zalo-session.mjs';
import {
    createFakeApi,
    createFakeLaravel,
    silentLogger,
    tick,
    zcaError,
} from '../support/helpers.mjs';

function contactsApi({ friends = [], groupIds = [], groupNames = {} } = {}) {
    const calls = { getAllFriends: [], getAllGroups: 0, getGroupInfo: [] };
    const api = createFakeApi();
    api.getAllFriends = async (...args) => {
        calls.getAllFriends.push(args);
        return friends;
    };
    api.getAllGroups = async () => {
        calls.getAllGroups += 1;
        return {
            version: '1',
            gridVerMap: Object.fromEntries(groupIds.map((id) => [id, '1'])),
        };
    };
    api.getGroupInfo = async (ids) => {
        calls.getGroupInfo.push(ids);
        return {
            removedsGroup: [],
            unchangedsGroup: [],
            gridInfoMap: Object.fromEntries(
                ids
                    .filter((id) => id in groupNames)
                    .map((id) => [
                        id,
                        { name: groupNames[id], memberIds: ['x'] },
                    ]),
            ),
        };
    };
    return { api, calls };
}

test('gộp bạn bè + nhóm thành {thread_id, type, name}, bỏ trường nhạy cảm', async () => {
    const { api, calls } = contactsApi({
        friends: [
            {
                userId: '1',
                displayName: ' An ',
                zaloName: 'an',
                phoneNumber: '0900000000',
            },
            { userId: '2', displayName: '', zaloName: 'Bình' },
            { userId: '', displayName: 'rỗng id' },
        ],
        groupIds: ['g1', 'g2'],
        groupNames: { g1: 'Nhóm một' },
    });
    const result = await fetchContacts(api, { gapMs: 0 });

    assert.deepEqual(result.contacts, [
        { thread_id: '1', type: 'user', name: 'An' },
        { thread_id: '2', type: 'user', name: 'Bình' },
        { thread_id: 'g1', type: 'group', name: 'Nhóm một' },
        { thread_id: 'g2', type: 'group', name: '' },
    ]);
    assert.equal(result.friends, 2);
    assert.equal(result.groups, 2);
    assert.equal(result.truncated, false);
    assert.equal(calls.getAllFriends.length, 1);
    assert.equal(JSON.stringify(result).includes('0900000000'), false);
});

test('nhóm được chia lô, có nghỉ giữa các lô và bị chặn ở MAX_GROUPS', async () => {
    const groupIds = Array.from(
        { length: MAX_GROUPS + 10 },
        (_, index) => `g${index}`,
    );
    const { api, calls } = contactsApi({ groupIds });
    const sleeps = [];
    const result = await fetchContacts(api, {
        chunkSize: 100,
        gapMs: 700,
        sleep: async (ms) => {
            sleeps.push(ms);
        },
    });

    assert.equal(result.groups, MAX_GROUPS);
    assert.equal(result.truncated, true);
    assert.equal(calls.getGroupInfo.length, 5);
    assert.ok(calls.getGroupInfo.every((ids) => ids.length <= 100));
    assert.deepEqual(sleeps, [700, 700, 700, 700]);
});

test('bạn bè vượt MAX_FRIENDS -> báo truncated nhưng vẫn gọi đúng một lần', async () => {
    const friends = Array.from({ length: MAX_FRIENDS + 1 }, (_, index) => ({
        userId: String(index),
        displayName: 'x',
    }));
    const { api, calls } = contactsApi({ friends });
    const result = await fetchContacts(api, { gapMs: 0 });
    assert.equal(result.truncated, true);
    assert.equal(calls.getAllFriends.length, 1);
});

async function runningSession(api, options = {}) {
    const zalo = { login: async () => api };
    const laravel = createFakeLaravel({
        getSession: async () => ({
            found: true,
            credentials: { cookie: '[]', imei: 'i', user_agent: 'u' },
        }),
    });
    const session = new ZaloSession({
        createZalo: () => zalo,
        laravel,
        logger: silentLogger,
        sendGapMs: 0,
        ...options,
    });
    await session.bootstrap();
    return session;
}

test('session.contacts: cache và dùng chung lượt đang chạy, hết hạn thì gọi lại', async () => {
    const { api, calls } = contactsApi({
        friends: [{ userId: '1', displayName: 'An' }],
    });
    let clock = 1_000;
    const session = await runningSession(api, {
        contactsOptions: { cacheMs: 1000, gapMs: 0 },
        now: () => clock,
    });

    const [a, b] = await Promise.all([session.contacts(), session.contacts()]);
    assert.equal(a, b);
    await session.contacts();
    assert.equal(calls.getAllFriends.length, 1);

    clock += 1001;
    await session.contacts();
    assert.equal(calls.getAllFriends.length, 2);
});

test('session.contacts: chưa đăng nhập -> 409; lỗi Zalo -> 502 contacts_failed và không cache lỗi', async () => {
    const idle = new ZaloSession({
        createZalo: () => ({}),
        laravel: createFakeLaravel(),
        logger: silentLogger,
    });
    await assert.rejects(
        idle.contacts(),
        (error) =>
            error instanceof BridgeError &&
            error.status === 409 &&
            error.code === 'not_logged_in',
    );

    const { api } = contactsApi();
    let fail = true;
    api.getAllFriends = async () => {
        if (fail) {
            throw zcaError('boom', 100);
        }
        return [];
    };
    const session = await runningSession(api, {
        contactsOptions: { gapMs: 0 },
    });
    await assert.rejects(
        session.contacts(),
        (error) => error.status === 502 && error.code === 'contacts_failed',
    );
    fail = false;
    assert.deepEqual((await session.contacts()).contacts, []);
});

test('đăng nhập QR xong -> báo Laravel running để đồng bộ danh bạ', async () => {
    const api = createFakeApi({ uid: '1001' });
    let resolve;
    let callback;
    const zalo = {
        loginQR: (options, cb) =>
            new Promise((res) => {
                callback = cb;
                resolve = res;
            }),
    };
    const laravel = createFakeLaravel();
    const session = new ZaloSession({
        createZalo: () => zalo,
        laravel,
        logger: silentLogger,
        sendGapMs: 0,
    });
    session.startQr();
    callback({
        type: 4,
        data: { cookie: [], imei: 'i', userAgent: 'u' },
        actions: {},
    });
    resolve(api);
    await tick();
    assert.deepEqual(laravel.calls.postStatus, [['running', undefined]]);
});
