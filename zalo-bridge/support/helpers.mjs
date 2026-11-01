import { EventEmitter } from 'node:events';

export const silentLogger = { log() {} };

export function createFakeApi({ uid = '1001', sendMessage } = {}) {
    const listener = new EventEmitter();
    listener.started = 0;
    listener.stopped = 0;
    listener.start = () => {
        listener.started += 1;
    };
    listener.stop = () => {
        listener.stopped += 1;
    };
    return {
        listener,
        getOwnId: () => uid,
        sendMessage:
            sendMessage ??
            (async () => ({ message: { msgId: 555 }, attachment: [] })),
    };
}

export function createFakeLaravel(overrides = {}) {
    const calls = {
        saveSession: [],
        postStatus: [],
        inbound: [],
        getSession: 0,
    };
    return {
        calls,
        getSession: async () => {
            calls.getSession += 1;
            return { found: false };
        },
        saveSession: async (credentials, account) => {
            calls.saveSession.push({ credentials, account });
        },
        postStatus: async (state, reason) => {
            calls.postStatus.push([state, reason]);
        },
        enqueueInbound: (payload) => {
            calls.inbound.push(payload);
        },
        ...overrides,
    };
}

export function zcaError(message, code) {
    const error = new Error(message);
    error.name = 'ZcaApiError';
    error.code = code ?? null;
    return error;
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));
