<?php

declare(strict_types=1);

namespace App\Services\Chat\Zalo;

/**
 * HMAC-SHA256 signature shared by Laravel and the sidecar, in both directions: `hex(HMAC(secret, "{ts}.{METHOD}.{path}.{body}"))`.
 * `path` includes the query string; an empty body is the empty string. `zalo-bridge/src/signature.mjs` must build the same string.
 */
final class BridgeSignature
{
    public const MAX_SKEW_SECONDS = 300;

    public static function sign(string $secret, int $timestamp, string $method, string $path, string $body): string
    {
        return hash_hmac('sha256', $timestamp.'.'.strtoupper($method).'.'.$path.'.'.$body, $secret);
    }

    public static function verify(string $secret, string $timestamp, string $signature, string $method, string $path, string $body, ?int $now = null): bool
    {
        if ($secret === '' || $signature === '' || preg_match('/^\d{1,12}$/', $timestamp) !== 1) {
            return false;
        }

        if (abs(($now ?? time()) - (int) $timestamp) > self::MAX_SKEW_SECONDS) {
            return false;
        }

        return hash_equals(self::sign($secret, (int) $timestamp, $method, $path, $body), $signature);
    }
}
