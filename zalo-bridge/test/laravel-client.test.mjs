import test from 'node:test';
import assert from 'node:assert/strict';
import { createLaravelClient } from '../src/laravel-client.mjs';
import { verify } from '../src/signature.mjs';
import { silentLogger, tick } from '../support/helpers.mjs';

const SECRET = 'test-secret';
const NOW = 1700000000;

function createClient(fetchImpl) {
    return createLaravelClient({
        baseUrl: 'http://127.0.0.1:8000',
        secret: SECRET,
        logger: silentLogger,
        fetchImpl,
        now: () => NOW,
    });
}

const response = (status, body = null) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
});

test('request tới Laravel được ký HMAC đúng chuẩn (cả GET rỗng và POST có body)', async () => {
    const seen = [];
    const client = createClient(async (url, init) => {
        seen.push({ url, init });
        return response(init.method === 'GET' ? 200 : 204, {
            credentials: { imei: 'i' },
        });
    });

    assert.deepEqual(await client.getSession(), {
        found: true,
        credentials: { imei: 'i' },
    });
    await client.saveSession(
        { cookie: 'c', imei: 'i', user_agent: 'u' },
        { uid: '1', name: 'A' },
    );

    assert.equal(seen[0].url, 'http://127.0.0.1:8000/internal/zalo/session');
    for (const { init } of seen) {
        const path = '/internal/zalo/session';
        assert.ok(
            verify({
                secret: SECRET,
                timestamp: init.headers['X-Bridge-Timestamp'],
                signature: init.headers['X-Bridge-Signature'],
                method: init.method,
                path,
                body: init.body ?? '',
                now: NOW,
            }),
        );
    }
});

test('getSession: 404 -> found=false; 5xx -> ném lỗi để bên gọi thử lại', async () => {
    assert.deepEqual(
        await createClient(async () => response(404)).getSession(),
        { found: false },
    );
    await assert.rejects(createClient(async () => response(503)).getSession());
});

test('postStatus là best-effort: lỗi mạng không ném', async () => {
    await createClient(async () => {
        throw new Error('ECONNREFUSED');
    }).postStatus('running');
});

test('inbound: 5xx giữ lại và gửi lại; 4xx bỏ, không gửi lại', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const statuses = [503, 200, 422];
    const sent = [];
    const client = createClient(async (url, init) => {
        sent.push(JSON.parse(init.body).message_id);
        return response(statuses.shift() ?? 200, { stored: true });
    });

    client.enqueueInbound({ message_id: 'a' });
    client.enqueueInbound({ message_id: 'b' });
    await tick();
    assert.deepEqual(sent, ['a']);
    assert.equal(client.pendingInbound(), 2);

    t.mock.timers.tick(2_000);
    await tick();
    await tick();
    assert.deepEqual(sent, ['a', 'a', 'b']); // a gửi lại thành công, b bị 422 rồi bỏ
    assert.equal(client.pendingInbound(), 0);
});

test('inbound: hàng đợi tối đa 500, tràn thì bỏ tin cũ nhất', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = createClient(async () => response(503));
    for (let i = 0; i < 505; i += 1)
        client.enqueueInbound({ message_id: String(i) });
    assert.equal(client.pendingInbound(), 500);
});
