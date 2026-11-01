export function loadConfig(env = process.env) {
    const secret = env.ZALO_BRIDGE_SECRET;
    if (typeof secret !== 'string' || secret.trim() === '') {
        throw new Error('Thiếu ZALO_BRIDGE_SECRET');
    }

    return {
        host: '127.0.0.1',
        port: parsePositiveInt(
            env.ZALO_BRIDGE_PORT,
            3790,
            'ZALO_BRIDGE_PORT',
            65535,
        ),
        secret,
        callbackUrl: (
            env.ZALO_BRIDGE_CALLBACK_URL || 'http://127.0.0.1:8000'
        ).replace(/\/+$/, ''),
        sendGapMs: parsePositiveInt(
            env.ZALO_BRIDGE_SEND_GAP_MS,
            2000,
            'ZALO_BRIDGE_SEND_GAP_MS',
            600000,
        ),
    };
}

function parsePositiveInt(raw, fallback, name, max) {
    if (raw === undefined || raw === '') {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > max) {
        throw new Error(`${name} không hợp lệ`);
    }
    return value;
}
