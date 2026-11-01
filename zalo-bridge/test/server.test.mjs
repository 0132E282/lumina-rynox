import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { sign } from '../src/signature.mjs';
import { createBridgeServer, MAX_BODY_BYTES } from '../src/server.mjs';
import { loadConfig } from '../src/config.mjs';
import { BridgeError } from '../src/zalo-session.mjs';
import { silentLogger } from '../support/helpers.mjs';

const SECRET = 'test-secret';
const NOW = 1700000000;

function createFakeSession(overrides = {}) {
    return {
        health: () => ({ state: 'idle', account: null }),
        startQr: () => ({ loginId: 'login-1' }),
        qrStatus: (id) =>
            id === 'login-1'
                ? {
                      state: 'waiting',
                      image: 'data:image/png;base64,AAA',
                      error_code: null,
                  }
                : null,
        cancelQr: () => {},
        send: async () => ({ message_id: '1' }),
        contacts: async () => ({
            contacts: [{ thread_id: '1', type: 'user', name: 'An' }],
            friends: 1,
            groups: 0,
            truncated: false,
        }),
        logout: () => {},
        ...overrides,
    };
}

async function withServer(session, run) {
    const bridge = createBridgeServer({
        session,
        secret: SECRET,
        logger: silentLogger,
        version: '9.9.9',
        now: () => NOW,
    });
    const address = await bridge.listen(0);
    try {
        await run(address);
    } finally {
        await bridge.close();
    }
}

async function call(
    address,
    method,
    path,
    { body, timestamp = String(NOW), signature, headers = {} } = {},
) {
    const raw =
        body === undefined
            ? ''
            : typeof body === 'string'
              ? body
              : JSON.stringify(body);
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: {
            'X-Bridge-Timestamp': timestamp,
            'X-Bridge-Signature':
                signature ?? sign(SECRET, timestamp, method, path, raw),
            ...headers,
        },
        body: raw === '' ? undefined : raw,
    });
    const text = await response.text();
    return {
        status: response.status,
        headers: response.headers,
        json: text ? JSON.parse(text) : null,
    };
}

test('chỉ bind 127.0.0.1', async () => {
    await withServer(createFakeSession(), (address) => {
        assert.equal(address.address, '127.0.0.1');
        assert.equal(loadConfig({ ZALO_BRIDGE_SECRET: 'x' }).host, '127.0.0.1');
    });
});

test('thiếu header chữ ký -> 401', async () => {
    await withServer(createFakeSession(), async (address) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/health`);
        assert.equal(response.status, 401);
    });
});

test('chữ ký sai hoặc lệch giờ -> 401', async () => {
    await withServer(createFakeSession(), async (address) => {
        assert.equal(
            (await call(address, 'GET', '/health', { signature: 'deadbeef' }))
                .status,
            401,
        );
        const stale = String(NOW - 301);
        assert.equal(
            (await call(address, 'GET', '/health', { timestamp: stale }))
                .status,
            401,
        );
    });
});

test('body > 64KB -> 413', async () => {
    await withServer(createFakeSession(), async (address) => {
        const big = JSON.stringify({ text: 'x'.repeat(MAX_BODY_BYTES + 10) });
        const result = await call(address, 'POST', '/send', { body: big });
        assert.equal(result.status, 413);
    });
});

test('GET /health ký đúng -> 200 kèm version, Cache-Control no-store', async () => {
    await withServer(createFakeSession(), async (address) => {
        const result = await call(address, 'GET', '/health');
        assert.equal(result.status, 200);
        assert.deepEqual(result.json, {
            state: 'idle',
            account: null,
            version: '9.9.9',
        });
        assert.equal(result.headers.get('cache-control'), 'no-store');
    });
});

test('phản hồi QR không cache và 404 với login_id lạ', async () => {
    await withServer(createFakeSession(), async (address) => {
        assert.equal(
            (await call(address, 'POST', '/qr/start')).json.login_id,
            'login-1',
        );
        const ok = await call(address, 'GET', '/qr/status?login_id=login-1');
        assert.equal(ok.status, 200);
        assert.equal(ok.json.state, 'waiting');
        assert.match(ok.headers.get('cache-control'), /no-store/);
        assert.equal(
            (await call(address, 'GET', '/qr/status?login_id=nope')).status,
            404,
        );
    });
});

test('POST /qr/start khi đang running -> 409', async () => {
    const session = createFakeSession({
        startQr: () => {
            throw new BridgeError(409, 'already_running');
        },
    });
    await withServer(session, async (address) => {
        const result = await call(address, 'POST', '/qr/start');
        assert.equal(result.status, 409);
        assert.equal(result.json.code, 'already_running');
    });
});

test('POST /qr/cancel và /logout -> 204', async () => {
    const seen = [];
    const session = createFakeSession({
        cancelQr: (id) => seen.push(id),
        logout: () => seen.push('logout'),
    });
    await withServer(session, async (address) => {
        assert.equal(
            (
                await call(address, 'POST', '/qr/cancel', {
                    body: { login_id: 'login-1' },
                })
            ).status,
            204,
        );
        assert.equal((await call(address, 'POST', '/logout')).status, 204);
        assert.deepEqual(seen, ['login-1', 'logout']);
    });
});

test('POST /send: validate 422, ánh xạ lỗi 409/422/502, thành công 200', async () => {
    const outcomes = [
        () => ({ message_id: '42' }),
        () => {
            throw new BridgeError(409, 'not_logged_in');
        },
        () => {
            throw new BridgeError(422, 'rejected');
        },
        () => {
            throw new BridgeError(502, 'ambiguous');
        },
    ];
    const session = createFakeSession({ send: async () => outcomes.shift()() });
    await withServer(session, async (address) => {
        const payload = { thread_id: 't1', thread_type: 'user', text: 'hi' };
        assert.equal(
            (
                await call(address, 'POST', '/send', {
                    body: { thread_id: '', thread_type: 'user', text: 'hi' },
                })
            ).status,
            422,
        );
        assert.equal(
            (
                await call(address, 'POST', '/send', {
                    body: { ...payload, thread_type: 'x' },
                })
            ).status,
            422,
        );
        assert.equal(
            (await call(address, 'POST', '/send', { body: 'not-json' })).status,
            422,
        );

        const success = await call(address, 'POST', '/send', { body: payload });
        assert.equal(success.status, 200);
        assert.equal(success.json.message_id, '42');
        assert.deepEqual(
            (await call(address, 'POST', '/send', { body: payload })).json,
            { code: 'not_logged_in' },
        );
        assert.deepEqual(
            (await call(address, 'POST', '/send', { body: payload })).json,
            { code: 'rejected' },
        );
        const ambiguous = await call(address, 'POST', '/send', {
            body: payload,
        });
        assert.equal(ambiguous.status, 502);
        assert.equal(ambiguous.json.code, 'ambiguous');
    });
});

test('GET /contacts: ký HMAC, trả danh bạ; chưa đăng nhập -> 409', async () => {
    let ok = true;
    const session = createFakeSession({
        contacts: async () => {
            if (!ok) {
                throw new BridgeError(409, 'not_logged_in');
            }
            return {
                contacts: [{ thread_id: '1', type: 'user', name: 'An' }],
                friends: 1,
                groups: 0,
                truncated: false,
            };
        },
    });
    await withServer(session, async (address) => {
        const response = await fetch(
            `http://127.0.0.1:${address.port}/contacts`,
        );
        assert.equal(response.status, 401);
        const result = await call(address, 'GET', '/contacts');
        assert.equal(result.status, 200);
        assert.equal(result.json.contacts[0].name, 'An');
        ok = false;
        const rejected = await call(address, 'GET', '/contacts');
        assert.equal(rejected.status, 409);
        assert.equal(rejected.json.code, 'not_logged_in');
    });
});

test('thiếu ZALO_BRIDGE_SECRET -> process thoát mã 1', () => {
    const env = { ...process.env };
    delete env.ZALO_BRIDGE_SECRET;
    const result = spawnSync(
        process.execPath,
        [new URL('../src/index.mjs', import.meta.url).pathname],
        { env, encoding: 'utf8', timeout: 15000 },
    );
    assert.equal(result.status, 1);
    assert.ok(!result.stdout.includes('secret='));
});
