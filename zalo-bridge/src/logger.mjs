const SENSITIVE_KEYS = new Set([
    'cookie',
    'imei',
    'useragent',
    'user_agent',
    'image',
    'qr',
    'text',
    'msg',
    'content',
    'secret',
    'signature',
    'credentials',
    'password',
    'token',
]);

export const REDACTED = '[REDACTED]';

/** Che đệ quy các khoá nhạy cảm (không phân biệt hoa thường). Không sửa đối tượng gốc. */
export function redact(value, depth = 0) {
    if (depth > 6 || value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => redact(item, depth + 1));
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        result[key] = SENSITIVE_KEYS.has(key.toLowerCase())
            ? REDACTED
            : redact(item, depth + 1);
    }
    return result;
}

/** Log JSON một dòng {time, event, code, ...fields đã che}. Không bao giờ nhận đối tượng zca-js. */
export function createLogger(
    write = (line) => process.stdout.write(`${line}\n`),
) {
    return {
        log(event, code = null, fields = {}) {
            write(
                JSON.stringify({
                    time: new Date().toISOString(),
                    event,
                    code,
                    ...redact(fields),
                }),
            );
        },
    };
}
