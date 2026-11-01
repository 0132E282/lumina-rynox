import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeError, ZaloSession } from '../src/zalo-session.mjs';
import {
    createFakeApi,
    createFakeLaravel,
    silentLogger,
    tick,
    zcaError,
} from '../support/helpers.mjs';

const STORED = {
    cookie: JSON.stringify([{ key: 'a', value: 'b' }]),
    imei: 'imei-1',
    user_agent: 'ua-1',
};

function createQrZalo() {
    const control = { callback: null, resolve: null, reject: null, aborted: 0 };
    const zalo = {
        loginQR: (options, callback) =>
            new Promise((resolve, reject) => {
                control.callback = callback;
                control.resolve = resolve;
                control.reject = reject;
            }),
        login: async () => {
            throw new Error('không dùng');
        },
    };
    control.actions = {
        abort: () => {
            control.aborted += 1;
        },
        retry: () => {},
    };
    control.emit = (type, data = null) =>
        control.callback({ type, data, actions: control.actions });
    return { zalo, control };
}

function createSession({ zalo, laravel = createFakeLaravel(), ...options }) {
    const session = new ZaloSession({
        createZalo: () => zalo,
        laravel,
        logger: silentLogger,
        sendGapMs: 0,
        ...options,
    });
    return { session, laravel };
}

test('QR: chuỗi sự kiện -> waiting/scanned/logged_in, saveSession đúng 1 lần, listener chạy', async () => {
    const { zalo, control } = createQrZalo();
    const { session, laravel } = createSession({ zalo });

    const { loginId } = session.startQr();
    assert.equal(session.health().state, 'qr_pending');

    control.emit(0, { image: 'QkFTRTY0', code: 'c', token: 't', options: {} });
    assert.deepEqual(session.qrStatus(loginId), {
        state: 'waiting',
        image: 'data:image/png;base64,QkFTRTY0',
        error_code: null,
    });

    control.emit(2, { avatar: 'a', display_name: 'Phúc' });
    assert.deepEqual(session.qrStatus(loginId), {
        state: 'scanned',
        image: null,
        error_code: null,
    });

    control.emit(4, {
        cookie: [{ key: 'z', value: 'v' }],
        imei: 'imei-9',
        userAgent: 'ua-9',
    });
    const api = createFakeApi({ uid: '1001' });
    control.resolve(api);
    await tick();

    assert.equal(session.qrStatus(loginId).state, 'logged_in');
    assert.equal(laravel.calls.saveSession.length, 1);
    assert.deepEqual(laravel.calls.saveSession[0], {
        credentials: {
            cookie: JSON.stringify([{ key: 'z', value: 'v' }]),
            imei: 'imei-9',
            user_agent: 'ua-9',
        },
        account: { uid: '1001', name: 'Phúc' },
    });
    assert.equal(api.listener.started, 1);
    assert.deepEqual(session.health(), {
        state: 'running',
        account: { uid: '1001', name: 'Phúc' },
    });
    assert.equal(session.qrStatus('khong-ton-tai'), null);
});

test('QR: hết hạn và bị từ chối -> trạng thái cuối, gọi abort, state về idle', async () => {
    for (const [eventType, expected] of [
        [1, 'expired'],
        [3, 'declined'],
    ]) {
        const { zalo, control } = createQrZalo();
        const { session } = createSession({ zalo });
        const { loginId } = session.startQr();
        control.emit(0, { image: 'AAA' });
        control.emit(eventType);
        assert.equal(session.qrStatus(loginId).state, expected);
        assert.equal(session.qrStatus(loginId).image, null);
        assert.equal(control.aborted, 1);
        assert.equal(session.health().state, 'idle');
        control.reject(new Error('aborted'));
        await tick();
        assert.equal(session.qrStatus(loginId).state, expected); // lỗi do abort không ghi đè
    }
});

test('QR: Laravel lưu phiên lỗi -> error save_failed, không chạy listener', async () => {
    const { zalo, control } = createQrZalo();
    const laravel = createFakeLaravel({
        saveSession: async () => {
            throw new Error('laravel_http_500');
        },
    });
    const { session } = createSession({ zalo, laravel });
    const { loginId } = session.startQr();
    control.emit(4, { cookie: [], imei: 'i', userAgent: 'u' });
    const api = createFakeApi();
    control.resolve(api);
    await tick();

    assert.deepEqual(session.qrStatus(loginId), {
        state: 'error',
        image: null,
        error_code: 'save_failed',
    });
    assert.equal(api.listener.started, 0);
    assert.notEqual(session.health().state, 'running');
});

test('QR: startQr huỷ phiên cũ (BR-008); đang running -> 409', async () => {
    const first = createQrZalo();
    const { session } = createSession({ zalo: first.zalo });
    const { loginId: oldId } = session.startQr();
    session.startQr();
    assert.equal(first.control.aborted, 0); // actions chưa có vì chưa có QR; phiên cũ bị đánh dấu kết thúc
    assert.equal(session.qrStatus(oldId), null);

    const running = createSession({
        zalo: { login: async () => createFakeApi() },
        laravel: createFakeLaravel({
            getSession: async () => ({ found: true, credentials: STORED }),
        }),
    });
    await running.session.bootstrap();
    assert.throws(
        () => running.session.startQr(),
        (error) => error instanceof BridgeError && error.status === 409,
    );
});

test('QR: cancelQr gọi abort của zca-js', async () => {
    const { zalo, control } = createQrZalo();
    const { session } = createSession({ zalo });
    const { loginId } = session.startQr();
    control.emit(0, { image: 'AAA' });
    session.cancelQr(loginId);
    assert.equal(control.aborted, 1);
    assert.equal(session.qrStatus(loginId), null);
});

test('khởi động: có phiên lưu -> login bằng credentials, running và báo Laravel', async () => {
    const api = createFakeApi();
    let received;
    const zalo = {
        login: async (credentials) => {
            received = credentials;
            return api;
        },
    };
    const laravel = createFakeLaravel({
        getSession: async () => ({ found: true, credentials: STORED }),
    });
    const { session } = createSession({ zalo, laravel });
    await session.bootstrap();

    assert.deepEqual(received, {
        cookie: [{ key: 'a', value: 'b' }],
        imei: 'imei-1',
        userAgent: 'ua-1',
    });
    assert.equal(session.health().state, 'running');
    assert.equal(laravel.calls.postStatus[0][0], 'running');
    assert.equal(api.listener.started, 1);
});

test('khởi động: không có phiên -> idle; ZaloApiError khi login -> session_lost', async () => {
    const empty = createSession({ zalo: {} });
    await empty.session.bootstrap();
    assert.equal(empty.session.health().state, 'idle');

    const laravel = createFakeLaravel({
        getSession: async () => ({ found: true, credentials: STORED }),
    });
    const lost = createSession({
        zalo: {
            login: async () => {
                throw zcaError('Đăng nhập thất bại');
            },
        },
        laravel,
    });
    await lost.session.bootstrap();
    assert.equal(lost.session.health().state, 'session_lost');
    assert.deepEqual(laravel.calls.postStatus, [
        ['session_lost', 'session_lost'],
    ]);
});

test('khởi động: Laravel chưa chạy -> thử lại theo lịch 5s,15s rồi thành công', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let attempts = 0;
    const laravel = createFakeLaravel({
        getSession: async () => {
            attempts += 1;
            if (attempts < 3) throw new Error('ECONNREFUSED');
            return { found: false };
        },
    });
    const { session } = createSession({ zalo: {}, laravel });
    const done = session.bootstrap();
    await tick();
    assert.equal(attempts, 1);
    t.mock.timers.tick(4_999);
    await tick();
    assert.equal(attempts, 1);
    t.mock.timers.tick(1);
    await tick();
    assert.equal(attempts, 2);
    t.mock.timers.tick(15_000);
    await done;
    assert.equal(attempts, 3);
});

async function startRunning({ loginImpl, laravelOverrides } = {}) {
    const apis = [];
    const logins = { count: 0 };
    const zalo = {
        login: async (credentials) => {
            logins.count += 1;
            if (loginImpl) return loginImpl(logins.count, apis);
            const api = createFakeApi();
            apis.push(api);
            return api;
        },
    };
    const laravel = createFakeLaravel({
        getSession: async () => ({ found: true, credentials: STORED }),
        ...laravelOverrides,
    });
    const { session } = createSession({ zalo, laravel });
    await session.bootstrap();
    return { session, laravel, apis, logins };
}

test('listener đóng thường -> reconnect theo lịch 5/15/30/60/120s rồi reconnect_exhausted', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { session, laravel, apis, logins } = await startRunning({
        loginImpl: async (count, list) => {
            if (count === 1) {
                const api = createFakeApi();
                list.push(api);
                return api;
            }
            throw new Error('network down'); // lỗi mạng, không phải ZaloApiError
        },
    });
    assert.equal(logins.count, 1);
    apis[0].listener.emit('closed', 1006, 'abnormal');
    await tick();
    assert.equal(session.health().state, 'reconnecting');

    for (const [index, delay] of [
        5_000, 15_000, 30_000, 60_000, 120_000,
    ].entries()) {
        t.mock.timers.tick(delay - 1);
        await tick();
        assert.equal(
            logins.count,
            1 + index,
            `chưa thử lần ${index + 1} trước ${delay}ms`,
        );
        t.mock.timers.tick(1);
        await tick();
        await tick();
        assert.equal(
            logins.count,
            2 + index,
            `đã thử lần ${index + 1} sau ${delay}ms`,
        );
    }

    assert.equal(logins.count, 6); // 1 lần đầu + đúng 5 lần reconnect
    assert.ok(
        laravel.calls.postStatus.some(
            ([state]) => state === 'reconnect_exhausted',
        ),
    );
    assert.equal(session.health().state, 'stopped');
    t.mock.timers.tick(600_000);
    await tick();
    assert.equal(logins.count, 6);
});

test('listener đóng thường rồi reconnect thành công -> running và báo Laravel', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { session, laravel, apis, logins } = await startRunning();
    apis[0].listener.emit('closed', 1006, '');
    await tick();
    t.mock.timers.tick(5_000);
    await tick();
    await tick();

    assert.equal(logins.count, 2);
    assert.equal(session.health().state, 'running');
    assert.equal(apis[1].listener.started, 1);
    assert.equal(
        laravel.calls.postStatus.filter(([state]) => state === 'running')
            .length,
        2,
    );
});

test('listener đóng do Zalo Web nơi khác (3000) -> displaced, không reconnect', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { session, laravel, apis, logins } = await startRunning();
    apis[0].listener.emit('closed', 3000, 'duplicate');
    await tick();

    assert.equal(session.health().state, 'displaced');
    assert.deepEqual(laravel.calls.postStatus.at(-1), [
        'displaced',
        'displaced',
    ]);
    t.mock.timers.tick(600_000);
    await tick();
    assert.equal(logins.count, 1);
});

test('tin đến -> chuẩn hoá và đẩy vào hàng đợi inbound; tin isSelf bị bỏ', async () => {
    const { laravel, apis } = await startRunning();
    const data = {
        msgId: '1',
        uidFrom: '2',
        dName: 'B',
        ts: '1700000000000',
        content: 'hi',
        msgType: 'webchat',
    };
    apis[0].listener.emit('message', {
        type: 0,
        threadId: '2',
        isSelf: false,
        data,
    });
    apis[0].listener.emit('message', {
        type: 0,
        threadId: '2',
        isSelf: true,
        data: { ...data, msgId: '2' },
    });
    assert.equal(laravel.calls.inbound.length, 1);
    assert.equal(laravel.calls.inbound[0].message_id, '1');
});

test('gửi tuần tự, cách nhau tối thiểu sendGapMs; trả message_id', async () => {
    const times = [];
    const api = createFakeApi({
        sendMessage: async () => {
            times.push(Date.now());
            return { message: { msgId: 7 }, attachment: [] };
        },
    });
    const laravel = createFakeLaravel({
        getSession: async () => ({ found: true, credentials: STORED }),
    });
    const session = new ZaloSession({
        createZalo: () => ({ login: async () => api }),
        laravel,
        logger: silentLogger,
        sendGapMs: 80,
    });
    await session.bootstrap();

    const results = await Promise.all(
        [1, 2, 3].map((n) =>
            session.send({ threadId: 't', threadType: 'user', text: `m${n}` }),
        ),
    );
    assert.deepEqual(results, [
        { message_id: '7' },
        { message_id: '7' },
        { message_id: '7' },
    ]);
    assert.equal(times.length, 3);
    assert.ok(times[1] - times[0] >= 75, `gap1=${times[1] - times[0]}`);
    assert.ok(times[2] - times[1] >= 75, `gap2=${times[2] - times[1]}`);
});

test('gửi: truyền ThreadType đúng và message null -> message_id null', async () => {
    const calls = [];
    const api = createFakeApi({
        sendMessage: async (...args) => {
            calls.push(args);
            return { message: null, attachment: [] };
        },
    });
    const laravel = createFakeLaravel({
        getSession: async () => ({ found: true, credentials: STORED }),
    });
    const session = new ZaloSession({
        createZalo: () => ({ login: async () => api }),
        laravel,
        logger: silentLogger,
        sendGapMs: 0,
    });
    await session.bootstrap();

    assert.deepEqual(
        await session.send({ threadId: 'g1', threadType: 'group', text: 'x' }),
        { message_id: null },
    );
    await session.send({ threadId: 'u1', threadType: 'user', text: 'y' });
    assert.deepEqual(calls, [
        [{ msg: 'x' }, 'g1', 1],
        [{ msg: 'y' }, 'u1', 0],
    ]);
});

test('gửi: lỗi mơ hồ -> 502 ambiguous, không gửi lại; Zalo từ chối có mã -> 422; chưa đăng nhập -> 409', async () => {
    const outcomes = [
        new Error('socket hang up'),
        zcaError('Request failed with status code 500'),
        zcaError('blocked', 114),
    ];
    let sendCalls = 0;
    const api = createFakeApi({
        sendMessage: async () => {
            sendCalls += 1;
            throw outcomes.shift();
        },
    });
    const laravel = createFakeLaravel({
        getSession: async () => ({ found: true, credentials: STORED }),
    });
    const session = new ZaloSession({
        createZalo: () => ({ login: async () => api }),
        laravel,
        logger: silentLogger,
        sendGapMs: 0,
    });

    await assert.rejects(
        session.send({ threadId: 't', threadType: 'user', text: 'x' }),
        (e) => e.status === 409 && e.code === 'not_logged_in',
    );
    await session.bootstrap();

    await assert.rejects(
        session.send({ threadId: 't', threadType: 'user', text: 'x' }),
        (e) => e.status === 502 && e.code === 'ambiguous',
    );
    assert.equal(sendCalls, 1);
    await assert.rejects(
        session.send({ threadId: 't', threadType: 'user', text: 'x' }),
        (e) => e.status === 502 && e.code === 'ambiguous',
    );
    await assert.rejects(
        session.send({ threadId: 't', threadType: 'user', text: 'x' }),
        (e) => e.status === 422 && e.code === 'rejected',
    );
    assert.equal(sendCalls, 3);
});

test('logout: dừng listener, bỏ listener cũ, state=stopped, gửi -> 409', async () => {
    const { session, apis } = await startRunning();
    session.logout();
    assert.equal(apis[0].listener.stopped, 1);
    assert.equal(session.health().state, 'stopped');
    assert.deepEqual(session.health().account, null);
    await assert.rejects(
        session.send({ threadId: 't', threadType: 'user', text: 'x' }),
        (e) => e.status === 409,
    );
    apis[0].listener.emit('closed', 1006, ''); // listener cũ không còn kích hoạt reconnect
    await tick();
    assert.equal(session.health().state, 'stopped');
});
