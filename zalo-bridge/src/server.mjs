import { createServer } from 'node:http';
import { verify } from './signature.mjs';
import { BridgeError } from './zalo-session.mjs';

export const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
    constructor(status, code) {
        super(code);
        this.status = status;
        this.code = code;
    }
}

/** HTTP server nội bộ (node:http), chỉ bind 127.0.0.1. Mọi request đều phải có chữ ký HMAC hợp lệ. */
export function createBridgeServer({
    session,
    secret,
    logger,
    version = '0.0.0',
    now = () => Math.floor(Date.now() / 1000),
}) {
    const server = createServer((request, response) => {
        handle(request, response).catch((error) => {
            if (error instanceof HttpError || error instanceof BridgeError) {
                respond(response, error.status, { code: error.code });
                return;
            }
            logger.log('request_failed', 'unexpected');
            respond(response, 500, { code: 'internal_error' });
        });
    });

    async function handle(request, response) {
        const timestamp = request.headers['x-bridge-timestamp'];
        const signature = request.headers['x-bridge-signature'];
        if (typeof timestamp !== 'string' || typeof signature !== 'string') {
            request.resume();
            throw new HttpError(401, 'unauthorized');
        }

        const rawBody = await readBody(request);
        const method = request.method ?? 'GET';
        const path = request.url ?? '/';
        if (
            !verify({
                secret,
                timestamp,
                signature,
                method,
                path,
                body: rawBody,
                now: now(),
            })
        ) {
            throw new HttpError(401, 'unauthorized');
        }

        const url = new URL(path, 'http://127.0.0.1');
        const route = `${method} ${url.pathname}`;

        switch (route) {
            case 'GET /health':
                return respond(response, 200, {
                    ...session.health(
                        accountKey(url.searchParams.get('account')),
                    ),
                    version,
                });
            case 'POST /qr/start':
                return respond(response, 200, {
                    login_id: session.startQr().loginId,
                });
            case 'GET /qr/status': {
                const status = session.qrStatus(
                    url.searchParams.get('login_id') ?? '',
                );
                if (!status) {
                    throw new HttpError(404, 'not_found');
                }
                return respond(response, 200, status);
            }
            case 'POST /qr/cancel': {
                const body = parseJson(rawBody);
                if (typeof body.login_id !== 'string') {
                    throw new HttpError(422, 'invalid');
                }
                session.cancelQr(body.login_id);
                return respond(response, 204);
            }
            case 'POST /send': {
                const body = parseJson(rawBody);
                const validThread =
                    typeof body.thread_id === 'string' && body.thread_id !== '';
                const validType =
                    body.thread_type === 'user' || body.thread_type === 'group';
                const validText =
                    typeof body.text === 'string' && body.text !== '';
                if (!validThread || !validType || !validText) {
                    throw new HttpError(422, 'invalid');
                }
                const result = await session.send({
                    account: accountKey(body.account),
                    threadId: body.thread_id,
                    threadType: body.thread_type,
                    text: body.text,
                });
                return respond(response, 200, result);
            }
            case 'GET /contacts':
                return respond(
                    response,
                    200,
                    await session.contacts(
                        accountKey(url.searchParams.get('account')),
                    ),
                );
            case 'POST /logout':
                session.logout(accountKey(parseJson(rawBody).account));
                return respond(response, 204);
            default:
                throw new HttpError(404, 'not_found');
        }
    }

    return {
        server,
        listen: (port, host = '127.0.0.1') =>
            new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, host, () => resolve(server.address()));
            }),
        close: () =>
            new Promise((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections?.();
            }),
    };
}

/** Khoá tài khoản (uid Zalo) tuỳ chọn; có mà sai định dạng thì 422. Không có = client cũ, chỉ hợp lệ khi có đúng một phiên. */
function accountKey(value) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
        throw new HttpError(422, 'invalid');
    }
    return value;
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        const declared = Number(request.headers['content-length'] ?? 0);
        if (declared > MAX_BODY_BYTES) {
            request.resume();
            reject(new HttpError(413, 'payload_too_large'));
            return;
        }
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                tooLarge = true;
                chunks.length = 0;
            } else if (!tooLarge) {
                chunks.push(chunk);
            }
        });
        request.on('end', () => {
            if (tooLarge) {
                reject(new HttpError(413, 'payload_too_large'));
            } else {
                resolve(Buffer.concat(chunks).toString('utf8'));
            }
        });
        request.on('error', reject);
    });
}

function parseJson(rawBody) {
    try {
        const parsed = JSON.parse(rawBody === '' ? '{}' : rawBody);
        if (
            parsed === null ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed)
        ) {
            throw new Error('not_object');
        }
        return parsed;
    } catch {
        throw new HttpError(422, 'invalid');
    }
}

function respond(response, status, payload) {
    const headers = {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        Connection: 'close',
    };
    if (payload === undefined) {
        response.writeHead(status, headers);
        response.end();
        return;
    }
    const body = JSON.stringify(payload);
    response.writeHead(status, {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
    });
    response.end(body);
}
