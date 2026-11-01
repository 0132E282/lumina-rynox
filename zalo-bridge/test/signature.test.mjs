import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sign, signingString, verify } from '../src/signature.mjs';

const fixtures = JSON.parse(
    readFileSync(
        new URL('./fixtures/hmac-vectors.json', import.meta.url),
        'utf8',
    ),
);

test('vector chung với PHP: chuỗi ký và chữ ký khớp', () => {
    for (const vector of fixtures.vectors) {
        assert.equal(
            signingString(
                vector.timestamp,
                vector.method,
                vector.path,
                vector.body,
            ),
            vector.signing_string,
            vector.name,
        );
        assert.equal(
            sign(
                fixtures.secret,
                vector.timestamp,
                vector.method,
                vector.path,
                vector.body,
            ),
            vector.signature,
            vector.name,
        );
    }
});

test('verify theo các ca dùng chung (đúng, sai chữ ký, lệch giờ, sửa body/path/method)', () => {
    for (const item of fixtures.verify_cases) {
        const result = verify({
            secret: fixtures.secret,
            timestamp: item.timestamp,
            signature: item.signature,
            method: item.method,
            path: item.path,
            body: item.body,
            now: item.now,
            tolerance: fixtures.tolerance_seconds,
        });
        assert.equal(result, item.expected, item.name);
    }
});

test('verify từ chối secret sai và timestamp không phải số', () => {
    const vector = fixtures.vectors[0];
    const base = {
        timestamp: vector.timestamp,
        signature: vector.signature,
        method: vector.method,
        path: vector.path,
        body: vector.body,
        now: 1700000000,
    };
    assert.equal(verify({ ...base, secret: fixtures.secret }), true);
    assert.equal(verify({ ...base, secret: 'other-secret' }), false);
    assert.equal(
        verify({ ...base, secret: fixtures.secret, timestamp: 'abc' }),
        false,
    );
    assert.equal(
        verify({ ...base, secret: fixtures.secret, signature: undefined }),
        false,
    );
});
