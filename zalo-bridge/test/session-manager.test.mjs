import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../src/session-manager.mjs';
import { BridgeError, ZaloSession } from '../src/zalo-session.mjs';
import { createLaravelClient } from '../src/laravel-client.mjs';
import {
    createFakeApi,
    createFakeLaravel,
    silentLogger,
    tick,
} from '../support/helpers.mjs';

const STORED = {
    cookie: JSON.stringify([{ key: 'a', value: 'b' }]),
    imei: 'imei',
    user_agent: 'ua',
};

/** Mỗi lần gọi createZalo() trả một zca-js giả: loginQR treo tới khi test resolve, login trả api theo uid đã lưu. */
function createHarness({ storedKeys = [] } = {}) {
    const qrControls = [];
    const sentBy = [];
    const laravelCalls = { status: [], inbound: [], saved: [] };
    const apis = new Map();

    const apiFor = (uid) => {
        if (!apis.has(uid)) {
            apis.set(
                uid,
                createFakeApi({
                    uid,
                    sendMessage: async () => {
                        sentBy.push(uid);
                        return { message: { msgId: `m-${uid}` } };
                    },
                }),
            );
        }
        return apis.get(uid);
    };

    const baseLaravel = {
        getSession: async (key) =>
            storedKeys.includes(key)
                ? { found: true, credentials: STORED }
                : { found: false },
        saveSession: async (credentials, account) => {
            laravelCalls.saved.push(account.uid);
        },
        postStatus: async (state, reason, key) => {
            laravelCalls.status.push([key, state]);
        },
        enqueueInbound: (payload) => {
            laravelCalls.inbound.push(payload);
        },
        listAccounts: async () => storedKeys,
    };
    const scopedFor = (key) => {
        let bound = key;
        return {
            bind: (value) => {
                bound = value;
            },
            getSession: () => baseLaravel.getSession(bound),
            saveSession: baseLaravel.saveSession,
            postStatus: (state, reason) =>
                baseLaravel.postStatus(state, reason, bound),
            enqueueInbound: (payload) =>
                baseLaravel.enqueueInbound({ ...payload, account: bound }),
        };
    };

    const manager = new SessionManager({
        laravel: baseLaravel,
        logger: silentLogger,
        bootstrapGapMs: 0,
        createSession: (key, onLoggedIn) =>
            new ZaloSession({
                laravel: scopedFor(key),
                logger: silentLogger,
                sendGapMs: 0,
                onLoggedIn,
                createZalo: () => ({
                    loginQR: (options, callback) =>
                        new Promise((resolve) => {
                            const control = {
                                callback,
                                resolve,
                                emit: (type, data = null) =>
                                    callback({
                                        type,
                                        data,
                                        actions: { abort() {} },
                                    }),
                            };
                            qrControls.push(control);
                        }),
                    login: async () => apiFor(key),
                }),
            }),
    });

    return { manager, qrControls, sentBy, laravelCalls, apiFor };
}

async function loginViaQr(harness, uid) {
    const { loginId } = harness.manager.startQr();
    const control = harness.qrControls.at(-1);
    control.emit(2, { display_name: `Tên ${uid}` });
    control.emit(4, {
        cookie: [{ key: 'k', value: 'v' }],
        imei: `i-${uid}`,
        userAgent: 'ua',
    });
    control.resolve(harness.apiFor(uid));
    await tick();
    return loginId;
}

test('hai tài khoản đăng nhập QR lần lượt: cùng chạy, health theo từng khoá', async () => {
    const harness = createHarness();
    await loginViaQr(harness, '1001');
    await loginViaQr(harness, '2002');

    assert.equal(harness.manager.health('1001').state, 'running');
    assert.equal(harness.manager.health('2002').state, 'running');
    assert.equal(harness.manager.health('3003').state, 'idle');
    assert.deepEqual(
        harness.manager
            .health()
            .accounts.map((item) => item.key)
            .sort(),
        ['1001', '2002'],
    );
    assert.deepEqual(harness.laravelCalls.saved, ['1001', '2002']);
    // Callback 'running' mang đúng khoá tài khoản.
    assert.deepEqual(harness.laravelCalls.status, [
        ['1001', 'running'],
        ['2002', 'running'],
    ]);
});

test('gửi đúng phiên theo khoá; thiếu khoá khi có >1 phiên bị từ chối', async () => {
    const harness = createHarness();
    await loginViaQr(harness, '1001');
    await loginViaQr(harness, '2002');

    await harness.manager.send({
        account: '2002',
        threadId: 't',
        threadType: 'user',
        text: 'hi',
    });
    await harness.manager.send({
        account: '1001',
        threadId: 't',
        threadType: 'user',
        text: 'hi',
    });
    assert.deepEqual(harness.sentBy, ['2002', '1001']);

    await assert.rejects(
        harness.manager.send({ threadId: 't', threadType: 'user', text: 'hi' }),
        (error) => error instanceof BridgeError && error.status === 422,
    );
    await assert.rejects(
        harness.manager.send({
            account: '9',
            threadId: 't',
            threadType: 'user',
            text: 'x',
        }),
        (error) => error.status === 409,
    );
});

test('tương thích ngược: một phiên duy nhất không cần khoá', async () => {
    const harness = createHarness();
    await loginViaQr(harness, '1001');

    await harness.manager.send({
        threadId: 't',
        threadType: 'user',
        text: 'hi',
    });
    assert.deepEqual(harness.sentBy, ['1001']);
    assert.equal(harness.manager.health().state, 'running');
    assert.deepEqual(harness.manager.health().account, {
        uid: '1001',
        name: 'Tên 1001',
    });
});

test('đăng xuất một tài khoản không ảnh hưởng tài khoản khác', async () => {
    const harness = createHarness();
    await loginViaQr(harness, '1001');
    await loginViaQr(harness, '2002');

    assert.throws(
        () => harness.manager.logout(),
        (error) => error instanceof BridgeError && error.status === 422,
    );

    harness.manager.logout('1001');

    assert.equal(harness.manager.health('1001').state, 'idle');
    assert.equal(harness.manager.health('2002').state, 'running');
    assert.equal(harness.apiFor('1001').listener.stopped, 1);
    assert.equal(harness.apiFor('2002').listener.stopped, 0);
    harness.manager.logout('khong-co'); // best-effort, không ném
});

test('đăng nhập lại cùng tài khoản thay thế phiên cũ', async () => {
    const harness = createHarness();
    await loginViaQr(harness, '1001');
    const first = harness.apiFor('1001');
    await loginViaQr(harness, '1001');

    assert.equal(harness.manager.health().accounts.length, 1);
    assert.equal(first.listener.stopped >= 1, true);
});

test('tin đến của mỗi phiên được gắn khoá tài khoản của phiên đó', async () => {
    const harness = createHarness();
    await loginViaQr(harness, '1001');
    await loginViaQr(harness, '2002');

    const message = (id) => ({
        type: 0,
        threadId: 'u9',
        data: {
            msgId: id,
            uidFrom: 'u9',
            content: 'xin chào',
            ts: '1700000000000',
            dName: 'Khách',
            mentions: [],
        },
        isSelf: false,
    });
    harness.apiFor('2002').listener.emit('message', message('a1'));
    harness.apiFor('1001').listener.emit('message', message('b1'));

    assert.deepEqual(
        harness.laravelCalls.inbound.map((payload) => payload.account),
        ['2002', '1001'],
    );
});

test('bootstrap khởi động lại mọi phiên Laravel đang giữ', async () => {
    const harness = createHarness({ storedKeys: ['1001', '2002'] });
    await harness.manager.bootstrap();

    assert.equal(harness.manager.health('1001').state, 'running');
    assert.equal(harness.manager.health('2002').state, 'running');
    assert.deepEqual(harness.laravelCalls.status, [
        ['1001', 'running'],
        ['2002', 'running'],
    ]);
});

test('forAccount: callback gắn khoá, getSession gửi ?account=', async () => {
    const seen = [];
    const client = createLaravelClient({
        baseUrl: 'http://x',
        secret: 's',
        logger: silentLogger,
        now: () => 1,
        fetchImpl: async (url, init) => {
            seen.push({ url, body: init.body });
            return {
                status: 200,
                ok: true,
                json: async () => ({ credentials: {}, accounts: ['7'] }),
            };
        },
    });
    const scoped = client.forAccount('7');
    await scoped.getSession();
    await scoped.postStatus('running');
    assert.equal(seen[0].url, 'http://x/internal/zalo/session?account=7');
    assert.equal(JSON.parse(seen[1].body).account, '7');
    assert.deepEqual(await client.listAccounts(), ['7']);
});
