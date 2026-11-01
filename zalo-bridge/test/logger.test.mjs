import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, redact, REDACTED } from '../src/logger.mjs';

test('redact che cookie/imei/userAgent/image/text kể cả lồng nhau và trong mảng', () => {
    const result = redact({
        code: 'ok',
        credentials: {
            cookie: 'COOKIE-SECRET',
            imei: 'IMEI-SECRET',
            userAgent: 'UA-SECRET',
        },
        nested: [
            {
                image: 'data:image/png;base64,QRDATA',
                Text: 'TIN-NHAN',
                user_agent: 'UA2',
            },
        ],
    });
    const output = JSON.stringify(result);
    for (const secret of [
        'COOKIE-SECRET',
        'IMEI-SECRET',
        'UA-SECRET',
        'QRDATA',
        'TIN-NHAN',
        'UA2',
    ]) {
        assert.ok(!output.includes(secret), `${secret} không được xuất hiện`);
    }
    assert.equal(result.nested[0].image, REDACTED);
    assert.equal(result.code, 'ok');
});

test('logger ghi JSON một dòng chỉ gồm event/code và trường đã che', () => {
    const lines = [];
    const logger = createLogger((line) => lines.push(line));
    logger.log('qr_logged_in', 'ok', {
        cookie: 'COOKIE-SECRET',
        msg: 'NOI-DUNG',
        attempt: 2,
    });

    assert.equal(lines.length, 1);
    assert.ok(
        !lines[0].includes('COOKIE-SECRET') && !lines[0].includes('NOI-DUNG'),
    );
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.event, 'qr_logged_in');
    assert.equal(parsed.code, 'ok');
    assert.equal(parsed.attempt, 2);
});
