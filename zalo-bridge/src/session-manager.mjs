import { BridgeError } from './zalo-session.mjs';

const MAX_QR_SESSIONS = 5;
const DEFAULT_BOOTSTRAP_GAP_MS = 2_000;
const DEFAULT_LIST_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

/**
 * Nhiều phiên Zalo cùng lúc, mỗi tài khoản một `ZaloSession` riêng (credential, listener, hàng đợi gửi, cache danh bạ riêng).
 * Khoá tài khoản là uid Zalo. Phiên đang quét QR chưa có uid nên được tra theo `login_id`; đăng nhập xong mới vào bảng theo uid.
 * Không truyền khoá tài khoản (client cũ) thì chỉ hợp lệ khi đang có đúng một phiên.
 * `createSession(accountKey|null)` trả về `{session, bind}`: factory tự gắn client Laravel theo khoá, nên module này không import zca-js.
 */
export class SessionManager {
    #createSession;
    #laravel;
    #logger;
    #bootstrapGapMs;
    #listRetryDelays;

    /** @type {Map<string, import('./zalo-session.mjs').ZaloSession>} */
    #sessions = new Map();
    /** @type {Map<string, import('./zalo-session.mjs').ZaloSession>} theo login_id, cũ nhất ở đầu */
    #qrSessions = new Map();
    #stopped = false;

    constructor({
        createSession,
        laravel,
        logger,
        bootstrapGapMs = DEFAULT_BOOTSTRAP_GAP_MS,
        listRetryDelaysMs = DEFAULT_LIST_RETRY_DELAYS_MS,
    }) {
        this.#createSession = createSession;
        this.#laravel = laravel;
        this.#logger = logger;
        this.#bootstrapGapMs = bootstrapGapMs;
        this.#listRetryDelays = listRetryDelaysMs;
    }

    health(accountKey) {
        if (accountKey) {
            return (
                this.#sessions.get(accountKey)?.health() ?? {
                    state: 'idle',
                    account: null,
                }
            );
        }
        const accounts = [...this.#sessions.entries()].map(
            ([key, session]) => ({ key, ...session.health() }),
        );
        const primary =
            accounts.find((item) => item.state === 'running') ?? accounts[0];
        const compact = accounts.map((item) => ({
            key: item.key,
            state: item.state,
            name: item.account?.name ?? null,
        }));
        // * Phần tương thích: chỉ có một tài khoản thì trả đúng dạng cũ {state, account}.
        return accounts.length === 1
            ? {
                  state: primary.state,
                  account: primary.account,
                  accounts: compact,
              }
            : {
                  state: primary?.state ?? 'idle',
                  account: null,
                  accounts: compact,
              };
    }

    startQr() {
        // * Chỉ giữ một phiên QR đang chờ: bấm "Thêm tài khoản" lần nữa thì mã cũ bị huỷ.
        for (const [loginId, session] of this.#qrSessions) {
            if (session.health().state === 'qr_pending') {
                session.cancelQr(loginId);
            }
        }
        const session = this.#createSession(null, (account) =>
            this.#adopt(session, account),
        );
        const { loginId } = session.startQr();
        this.#qrSessions.set(loginId, session);
        while (this.#qrSessions.size > MAX_QR_SESSIONS) {
            this.#qrSessions.delete(this.#qrSessions.keys().next().value);
        }
        return { loginId };
    }

    qrStatus(loginId) {
        return this.#qrSessions.get(loginId)?.qrStatus(loginId) ?? null;
    }

    cancelQr(loginId) {
        this.#qrSessions.get(loginId)?.cancelQr(loginId);
    }

    async send({ account, ...message }) {
        return this.#resolve(account).send(message);
    }

    async contacts(accountKey) {
        return this.#resolve(accountKey).contacts();
    }

    /** Đăng xuất một phiên (không có khoá: phiên duy nhất, nếu có). Khoá không tồn tại cũng là thành công: không còn gì để huỷ. */
    logout(accountKey) {
        if (accountKey) {
            this.#sessions.get(accountKey)?.logout();
            this.#sessions.delete(accountKey);
            return;
        }
        if (this.#sessions.size > 1) {
            throw new BridgeError(422, 'invalid');
        }
        for (const [key, session] of this.#sessions) {
            session.logout();
            this.#sessions.delete(key);
        }
    }

    /** Khởi động lại mọi phiên Laravel đang giữ, lần lượt và cách nhau vài giây để không đăng nhập dồn dập. */
    async bootstrap() {
        let keys;
        for (let attempt = 0; ; attempt += 1) {
            if (this.#stopped) {
                return;
            }
            try {
                keys = await this.#laravel.listAccounts();
                break;
            } catch {
                this.#logger.log('bootstrap_retry', 'laravel_unavailable');
                const delay =
                    this.#listRetryDelays[
                        Math.min(attempt, this.#listRetryDelays.length - 1)
                    ];
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        let first = true;
        for (const key of keys) {
            if (this.#stopped || this.#sessions.has(key)) {
                continue;
            }
            if (!first && this.#bootstrapGapMs > 0) {
                await new Promise((resolve) =>
                    setTimeout(resolve, this.#bootstrapGapMs),
                );
            }
            first = false;
            const session = this.#createSession(key, null);
            this.#sessions.set(key, session);
            await session.bootstrap();
        }
    }

    shutdown() {
        this.#stopped = true;
        for (const session of this.#sessions.values()) {
            session.shutdown();
        }
        this.#sessions.clear();
        for (const session of this.#qrSessions.values()) {
            session.shutdown();
        }
        this.#qrSessions.clear();
    }

    /** Đăng nhập QR xong: phiên vào bảng theo uid; phiên cũ của cùng tài khoản (đăng nhập lại) bị thay thế. */
    #adopt(session, account) {
        const previous = this.#sessions.get(account.uid);
        if (previous && previous !== session) {
            previous.logout();
        }
        this.#sessions.set(account.uid, session);
    }

    #resolve(accountKey) {
        if (accountKey) {
            const session = this.#sessions.get(accountKey);
            if (!session) {
                throw new BridgeError(409, 'not_logged_in');
            }
            return session;
        }
        if (this.#sessions.size === 1) {
            return this.#sessions.values().next().value;
        }
        throw new BridgeError(
            this.#sessions.size === 0 ? 409 : 422,
            this.#sessions.size === 0 ? 'not_logged_in' : 'invalid',
        );
    }
}
