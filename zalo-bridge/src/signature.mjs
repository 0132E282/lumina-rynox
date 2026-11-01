import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Chuỗi ký: "{ts}.{METHOD}.{path}.{rawBody}" (path gồm query string, body rỗng là chuỗi rỗng). */
export function signingString(timestamp, method, path, body) {
    return `${timestamp}.${String(method).toUpperCase()}.${path}.${body ?? ''}`;
}

export function sign(secret, timestamp, method, path, body = '') {
    return createHmac('sha256', secret)
        .update(signingString(timestamp, method, path, body))
        .digest('hex');
}

/**
 * So khớp chữ ký trong thời gian hằng định và chặn lệch timestamp quá `tolerance` giây.
 * `now` tính bằng giây Unix (truyền vào để test).
 */
export function verify({
    secret,
    timestamp,
    signature,
    method,
    path,
    body = '',
    now = Math.floor(Date.now() / 1000),
    tolerance = SIGNATURE_TOLERANCE_SECONDS,
}) {
    if (
        typeof signature !== 'string' ||
        typeof timestamp !== 'string' ||
        !/^\d{1,12}$/.test(timestamp)
    ) {
        return false;
    }
    if (Math.abs(now - Number(timestamp)) > tolerance) {
        return false;
    }
    const expected = Buffer.from(
        sign(secret, timestamp, method, path, body),
        'utf8',
    );
    const actual = Buffer.from(signature, 'utf8');
    if (expected.length !== actual.length) {
        return false;
    }
    return timingSafeEqual(expected, actual);
}
