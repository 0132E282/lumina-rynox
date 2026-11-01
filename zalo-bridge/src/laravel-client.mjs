import { sign } from './signature.mjs';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_INBOUND_QUEUE = 500;
const INBOUND_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/**
 * Gọi /internal/zalo/* của Laravel (ký HMAC). Không log body/response.
 * `fetchImpl` được inject để test không cần mạng.
 */
export function createLaravelClient({
    baseUrl,
    secret,
    logger,
    fetchImpl = fetch,
    now = () => Math.floor(Date.now() / 1000),
}) {
    const inboundQueue = [];
    let draining = false;

    async function request(method, path, payload) {
        const body = payload === undefined ? '' : JSON.stringify(payload);
        const timestamp = String(now());
        const headers = {
            'X-Bridge-Timestamp': timestamp,
            'X-Bridge-Signature': sign(secret, timestamp, method, path, body),
            Accept: 'application/json',
        };
        if (body !== '') {
            headers['Content-Type'] = 'application/json';
        }
        return fetchImpl(`${baseUrl}${path}`, {
            method,
            headers,
            body: body === '' ? undefined : body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    }

    async function drainInbound() {
        if (draining) {
            return;
        }
        draining = true;
        let attempt = 0;
        try {
            while (inboundQueue.length > 0) {
                let retry = false;
                try {
                    const response = await request(
                        'POST',
                        '/internal/zalo/inbound',
                        inboundQueue[0],
                    );
                    if (response.status >= 500) {
                        retry = true;
                    } else if (response.status >= 400) {
                        logger.log(
                            'inbound_rejected',
                            `http_${response.status}`,
                        );
                    }
                } catch {
                    retry = true;
                }

                if (retry) {
                    const delay =
                        INBOUND_RETRY_DELAYS_MS[
                            Math.min(
                                attempt,
                                INBOUND_RETRY_DELAYS_MS.length - 1,
                            )
                        ];
                    attempt += 1;
                    logger.log('inbound_retry', 'laravel_unavailable');
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }

                attempt = 0;
                inboundQueue.shift();
            }
        } finally {
            draining = false;
        }
    }

    const client = {
        /** -> {found:false} | {found:true, credentials}; ném lỗi khi mạng/5xx để bên gọi thử lại. */
        async getSession(accountKey) {
            const response = await request(
                'GET',
                `/internal/zalo/session${accountQuery(accountKey)}`,
            );
            if (response.status === 404) {
                return { found: false };
            }
            if (!response.ok) {
                throw new Error(`laravel_http_${response.status}`);
            }
            const data = await response.json();
            return { found: true, credentials: data.credentials };
        },

        /** Ném lỗi nếu Laravel không trả 2xx. */
        async saveSession(credentials, account) {
            const response = await request('POST', '/internal/zalo/session', {
                credentials,
                account,
            });
            if (!response.ok) {
                throw new Error(`laravel_http_${response.status}`);
            }
        },

        /** Best-effort: không ném lỗi. */
        async postStatus(state, reasonCode = null, accountKey = undefined) {
            try {
                const response = await request(
                    'POST',
                    '/internal/zalo/status',
                    {
                        state,
                        reason_code: reasonCode,
                        ...(accountKey ? { account: accountKey } : {}),
                    },
                );
                if (!response.ok) {
                    logger.log('status_rejected', `http_${response.status}`);
                }
            } catch {
                logger.log('status_failed', 'laravel_unavailable');
            }
        },

        enqueueInbound(payload) {
            if (inboundQueue.length >= MAX_INBOUND_QUEUE) {
                inboundQueue.shift();
                logger.log('inbound_dropped', 'queue_overflow');
            }
            inboundQueue.push(payload);
            void drainInbound();
        },

        pendingInbound: () => inboundQueue.length,

        /** Khoá các tài khoản Laravel đang giữ phiên (để sidecar khởi động lại mọi phiên); ném lỗi khi mạng/5xx. */
        async listAccounts() {
            const response = await request('GET', '/internal/zalo/accounts');
            if (!response.ok) {
                throw new Error(`laravel_http_${response.status}`);
            }
            const data = await response.json();
            return Array.isArray(data.accounts)
                ? data.accounts.filter(
                      (key) => typeof key === 'string' && key !== '',
                  )
                : [];
        },

        /**
         * Phiên bản gắn với MỘT tài khoản: ZaloSession dùng y như client đơn. `bind(key)` chốt khoá sau khi đăng nhập QR
         * (lúc bắt đầu chưa biết uid); từ đó mọi callback đều mang khoá này.
         */
        forAccount(initialKey = null) {
            let key = initialKey;
            return {
                bind: (accountKey) => {
                    key = accountKey;
                },
                getSession: () => client.getSession(key ?? undefined),
                saveSession: (credentials, account) =>
                    client.saveSession(credentials, account),
                postStatus: (state, reasonCode = null) =>
                    client.postStatus(state, reasonCode, key ?? undefined),
                enqueueInbound: (payload) =>
                    client.enqueueInbound(
                        key ? { ...payload, account: key } : payload,
                    ),
            };
        },
    };

    return client;
}

function accountQuery(accountKey) {
    return accountKey ? `?${new URLSearchParams({ account: accountKey })}` : '';
}
