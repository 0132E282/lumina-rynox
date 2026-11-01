import { randomUUID } from 'node:crypto';
import { fetchContacts } from './contacts.mjs';
import { normalizeMessage, THREAD_TYPE_GROUP } from './normalize.mjs';

// CloseReason của zca-js (apis/listen.d.ts): ManualClosure 1000, DuplicateConnection 3000, KickConnection 3003.
const CLOSE_MANUAL = 1000;
const CLOSE_DUPLICATE_CONNECTION = 3000;
const CLOSE_KICKED = 3003;

// LoginQRCallbackEventType của zca-js (apis/loginQR.d.ts).
const QR_GENERATED = 0;
const QR_EXPIRED = 1;
const QR_SCANNED = 2;
const QR_DECLINED = 3;
const QR_GOT_LOGIN_INFO = 4;

const QR_IMAGE_PREFIX = 'data:image/png;base64,';
const DEFAULT_RECONNECT_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
const DEFAULT_BOOTSTRAP_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];
const CONTACTS_CACHE_MS = 5 * 60_000;

export class BridgeError extends Error {
    constructor(status, code) {
        super(code);
        this.status = status;
        this.code = code;
    }
}

/** zca-js ném ZaloApiError (name "ZcaApiError"); `code` là số khi Zalo trả error_code rõ ràng. */
function isZaloApiError(error) {
    return error?.name === 'ZcaApiError';
}

/**
 * Máy trạng thái phiên Zalo. `createZalo()` trả về một instance zca-js (hoặc mock) có
 * login(credentials) và loginQR(options, callback); module này không import zca-js.
 */
export class ZaloSession {
    #createZalo;
    #laravel;
    #logger;
    #sendGapMs;
    #reconnectDelays;
    #bootstrapDelays;
    #onLoggedIn;

    #state = 'idle';
    #api = null;
    #account = null;
    #listenerEpoch = 0;
    #qr = null;
    #reconnectTimer = null;
    #sendChain = Promise.resolve();
    #lastSendAt = 0;
    #contactsOptions;
    #contactsCache = null;
    #contactsInFlight = null;

    constructor({
        createZalo,
        laravel,
        logger,
        sendGapMs = 2000,
        reconnectDelaysMs = DEFAULT_RECONNECT_DELAYS_MS,
        bootstrapDelaysMs = DEFAULT_BOOTSTRAP_DELAYS_MS,
        contactsOptions = {},
        onLoggedIn = null,
        now = Date.now,
    }) {
        this.#onLoggedIn = onLoggedIn;
        this.#contactsOptions = {
            cacheMs: CONTACTS_CACHE_MS,
            ...contactsOptions,
            now,
        };
        this.#createZalo = createZalo;
        this.#laravel = laravel;
        this.#logger = logger;
        this.#sendGapMs = sendGapMs;
        this.#reconnectDelays = reconnectDelaysMs;
        this.#bootstrapDelays = bootstrapDelaysMs;
    }

    health() {
        return { state: this.#state, account: this.#account };
    }

    // ---------------------------------------------------------------- QR

    startQr() {
        if (this.#state === 'running') {
            throw new BridgeError(409, 'already_running');
        }
        this.#discardQr();
        this.#clearReconnect();

        const qr = {
            loginId: randomUUID(),
            state: 'waiting',
            image: null,
            errorCode: null,
            displayName: null,
            credentials: null,
            actions: null,
            finished: false,
        };
        this.#qr = qr;
        this.#state = 'qr_pending';

        const zalo = this.#createZalo();
        zalo.loginQR({}, (event) => this.#onQrEvent(qr, event))
            .then((api) => this.#onQrLoggedIn(qr, api))
            .catch((error) => {
                if (qr.finished) {
                    return; // đã hết hạn/từ chối/huỷ: promise bị abort là bình thường
                }
                this.#failQr(qr, 'login_failed');
                this.#logger.log(
                    'qr_login_failed',
                    isZaloApiError(error) ? 'zalo_api_error' : 'unexpected',
                );
            });

        return { loginId: qr.loginId };
    }

    qrStatus(loginId) {
        if (!this.#qr || this.#qr.loginId !== loginId) {
            return null;
        }
        return {
            state: this.#qr.state,
            image: this.#qr.state === 'waiting' ? this.#qr.image : null,
            error_code: this.#qr.errorCode,
            // * Khoá của phiên mới (uid) chỉ có sau khi đăng nhập xong; Laravel dùng nó để gắn quyền đã chọn vào đúng tài khoản.
            ...(this.#qr.state === 'logged_in'
                ? { account_key: this.#account?.uid ?? null }
                : {}),
        };
    }

    cancelQr(loginId) {
        if (this.#qr && this.#qr.loginId === loginId) {
            this.#discardQr();
        }
    }

    #onQrEvent(qr, event) {
        if (this.#qr !== qr || qr.finished) {
            return;
        }
        switch (event.type) {
            case QR_GENERATED:
                qr.actions = event.actions;
                qr.state = 'waiting';
                qr.image = `${QR_IMAGE_PREFIX}${event.data.image}`;
                break;
            case QR_SCANNED:
                qr.state = 'scanned';
                qr.image = null;
                qr.displayName = event.data?.display_name ?? null;
                break;
            case QR_EXPIRED:
                this.#endQr(qr, 'expired');
                break;
            case QR_DECLINED:
                this.#endQr(qr, 'declined');
                break;
            case QR_GOT_LOGIN_INFO:
                qr.credentials = {
                    cookie: JSON.stringify(event.data.cookie),
                    imei: event.data.imei,
                    user_agent: event.data.userAgent,
                };
                break;
            default:
                break;
        }
    }

    async #onQrLoggedIn(qr, api) {
        if (this.#qr !== qr || qr.finished) {
            return;
        }
        const credentials = qr.credentials;
        qr.credentials = null;
        const account = {
            uid: String(api.getOwnId()),
            name: qr.displayName ?? `Zalo ${api.getOwnId()}`,
        };

        if (!credentials) {
            this.#failQr(qr, 'login_failed');
            return;
        }
        // * Khoá tài khoản chỉ biết sau khi đăng nhập: từ đây mọi callback về Laravel gắn với nó.
        this.#laravel.bind?.(account.uid);
        try {
            await this.#laravel.saveSession(credentials, account);
        } catch {
            this.#failQr(qr, 'save_failed');
            this.#logger.log('qr_save_failed', 'save_failed');
            return;
        }
        if (this.#qr !== qr || qr.finished) {
            return; // người dùng huỷ trong lúc lưu
        }

        qr.finished = true;
        qr.state = 'logged_in';
        qr.image = null;
        this.#account = account;
        this.#startListener(api);
        this.#state = 'running';
        this.#contactsCache = null;
        this.#logger.log('qr_logged_in', 'ok');
        this.#onLoggedIn?.(account);
        // Laravel đồng bộ danh bạ một lần khi nhận 'running' (lúc lưu phiên sidecar chưa sẵn sàng trả danh bạ).
        void this.#laravel.postStatus('running');
    }

    /** Kết thúc phiên QR ở trạng thái cuối, gọi abort để zca-js dọn promise đang treo. */
    #endQr(qr, finalState) {
        qr.finished = true;
        qr.state = finalState;
        qr.image = null;
        const abort = qr.actions?.abort;
        qr.actions = null;
        if (this.#state === 'qr_pending') {
            this.#state = 'idle';
        }
        abort?.();
    }

    #failQr(qr, errorCode) {
        qr.errorCode = errorCode;
        this.#endQr(qr, 'error');
    }

    #discardQr() {
        const qr = this.#qr;
        if (!qr) {
            return;
        }
        this.#qr = null;
        qr.credentials = null;
        if (!qr.finished) {
            qr.finished = true;
            qr.actions?.abort?.();
        }
        if (this.#state === 'qr_pending') {
            this.#state = 'idle';
        }
    }

    // ---------------------------------------------------------------- khởi động / đăng nhập lại

    /** Xin phiên đã lưu từ Laravel; Laravel chưa chạy thì thử lại 5s/15s/30s/60s rồi giữ chu kỳ 60s. */
    async bootstrap() {
        let attempt = 0;
        for (;;) {
            if (this.#state !== 'idle') {
                return;
            }
            try {
                const session = await this.#laravel.getSession();
                if (!session.found) {
                    return;
                }
                await this.#connectStored(session.credentials);
                return;
            } catch {
                const delay =
                    this.#bootstrapDelays[
                        Math.min(attempt, this.#bootstrapDelays.length - 1)
                    ];
                attempt += 1;
                this.#logger.log('bootstrap_retry', 'laravel_unavailable');
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    async #connectStored(storedCredentials) {
        this.#state = 'connecting';
        let api;
        try {
            api = await this.#createZalo().login(
                toZcaCredentials(storedCredentials),
            );
        } catch (error) {
            if (isZaloApiError(error)) {
                await this.#markTerminal('session_lost', 'session_lost');
                return;
            }
            this.#state = 'idle';
            throw error; // lỗi mạng: bootstrap/reconnect thử lại theo lịch
        }
        this.#startListener(api);
        this.#state = 'running';
        await this.#laravel.postStatus('running');
        this.#logger.log('session_running', 'ok');
    }

    // ---------------------------------------------------------------- listener

    #startListener(api) {
        this.#detachListener();
        this.#api = api;
        const epoch = ++this.#listenerEpoch;
        const ownUid = String(api.getOwnId());
        if (!this.#account || this.#account.uid !== ownUid) {
            this.#account = { uid: ownUid, name: this.#account?.name ?? null };
        }

        api.listener.on('message', (message) => {
            if (epoch !== this.#listenerEpoch) {
                return;
            }
            const payload = normalizeMessage(message, ownUid);
            if (payload && !payload.is_self) {
                this.#laravel.enqueueInbound(payload);
            }
        });
        api.listener.on('error', () => {
            if (epoch === this.#listenerEpoch) {
                this.#logger.log('listener_error', 'listener_error');
            }
        });
        api.listener.on('closed', (code) => {
            if (epoch === this.#listenerEpoch) {
                void this.#onListenerClosed(code);
            }
        });
        api.listener.start({ retryOnClose: false });
    }

    #detachListener() {
        this.#listenerEpoch += 1; // vô hiệu mọi callback của listener cũ
        const api = this.#api;
        this.#api = null;
        try {
            api?.listener?.stop();
        } catch {
            this.#logger.log('listener_stop_failed', 'stop_failed');
        }
    }

    async #onListenerClosed(code) {
        this.#logger.log('listener_closed', `close_${code}`);
        if (code === CLOSE_MANUAL) {
            return;
        }
        this.#api = null;
        if (code === CLOSE_DUPLICATE_CONNECTION) {
            await this.#markTerminal('displaced', 'displaced');
            return;
        }
        if (code === CLOSE_KICKED) {
            await this.#markTerminal('session_lost', 'session_lost');
            return;
        }
        this.#scheduleReconnect(0);
    }

    #scheduleReconnect(attempt) {
        if (attempt >= this.#reconnectDelays.length) {
            void this.#markTerminal('stopped', 'reconnect_exhausted');
            return;
        }
        this.#state = 'reconnecting';
        this.#reconnectTimer = setTimeout(async () => {
            this.#reconnectTimer = null;
            if (this.#state !== 'reconnecting') {
                return;
            }
            try {
                const session = await this.#laravel.getSession();
                if (!session.found) {
                    await this.#markTerminal('session_lost', 'session_lost');
                    return;
                }
                await this.#connectStored(session.credentials);
                if (this.#state === 'idle') {
                    this.#state = 'reconnecting';
                    this.#scheduleReconnect(attempt + 1);
                }
            } catch {
                this.#state = 'reconnecting';
                this.#scheduleReconnect(attempt + 1);
            }
        }, this.#reconnectDelays[attempt]);
    }

    #clearReconnect() {
        if (this.#reconnectTimer) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
    }

    /** Đặt trạng thái cục bộ và báo Laravel: {state: postedState, reason_code: postedState}. */
    async #markTerminal(localState, postedState) {
        this.#state = localState;
        await this.#laravel.postStatus(postedState, postedState);
    }

    // ---------------------------------------------------------------- gửi tin

    /** Xếp hàng tuần tự; mỗi lần gửi cách lần trước tối thiểu sendGapMs. Không bao giờ tự gửi lại. */
    send({ threadId, threadType, text }) {
        if (this.#state !== 'running' || !this.#api) {
            return Promise.reject(new BridgeError(409, 'not_logged_in'));
        }
        const run = async () => {
            const wait = this.#lastSendAt + this.#sendGapMs - Date.now();
            if (wait > 0) {
                await new Promise((resolve) => setTimeout(resolve, wait));
            }
            const api = this.#api;
            if (this.#state !== 'running' || !api) {
                throw new BridgeError(409, 'not_logged_in');
            }
            this.#lastSendAt = Date.now();
            try {
                const result = await api.sendMessage(
                    { msg: text },
                    threadId,
                    threadType === 'group' ? THREAD_TYPE_GROUP : 0,
                );
                const messageId = result?.message?.msgId;
                return {
                    message_id:
                        messageId === undefined || messageId === null
                            ? null
                            : String(messageId),
                };
            } catch (error) {
                if (isZaloApiError(error) && typeof error.code === 'number') {
                    throw new BridgeError(422, 'rejected');
                }
                throw new BridgeError(502, 'ambiguous');
            }
        };
        const task = this.#sendChain.then(run, run);
        this.#sendChain = task.catch(() => undefined);
        return task;
    }

    // ---------------------------------------------------------------- danh bạ

    /**
     * Danh bạ (bạn bè + nhóm) trong một lượt; cache trong bộ nhớ vài phút và dùng chung lượt đang chạy
     * nên gọi dồn dập không tạo thêm request tới Zalo. Không bao giờ log tên/số điện thoại.
     */
    contacts() {
        if (this.#state !== 'running' || !this.#api) {
            return Promise.reject(new BridgeError(409, 'not_logged_in'));
        }
        const { cacheMs, now, ...fetchOptions } = this.#contactsOptions;
        if (this.#contactsCache && now() - this.#contactsCache.at < cacheMs) {
            return Promise.resolve(this.#contactsCache.result);
        }
        if (this.#contactsInFlight) {
            return this.#contactsInFlight;
        }
        const api = this.#api;
        this.#contactsInFlight = fetchContacts(api, fetchOptions)
            .then((result) => {
                if (this.#api === api) {
                    this.#contactsCache = { at: now(), result };
                }
                return result;
            })
            .catch((error) => {
                this.#logger.log(
                    'contacts_failed',
                    isZaloApiError(error) ? 'zalo_api_error' : 'unexpected',
                );
                throw new BridgeError(502, 'contacts_failed');
            })
            .finally(() => {
                this.#contactsInFlight = null;
            });
        return this.#contactsInFlight;
    }

    // ---------------------------------------------------------------- dừng

    logout() {
        this.#clearReconnect();
        this.#discardQr();
        this.#detachListener();
        this.#account = null;
        this.#contactsCache = null;
        this.#state = 'stopped';
    }

    shutdown() {
        this.logout();
    }
}

function toZcaCredentials(stored) {
    return {
        cookie:
            typeof stored.cookie === 'string'
                ? JSON.parse(stored.cookie)
                : stored.cookie,
        imei: stored.imei,
        userAgent: stored.user_agent,
    };
}
