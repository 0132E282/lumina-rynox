<?php

declare(strict_types=1);

namespace App\Services\Mail\Imap;

use ValueError;

/** * Decodes one MIME part body (transfer encoding, then charset) to UTF-8. */
final class PartDecoder
{
    public static function decode(string $raw, string $encoding, ?string $charset): string
    {
        $bytes = match (strtolower($encoding)) {
            'base64' => (string) base64_decode($raw),
            'quoted-printable' => quoted_printable_decode($raw),
            default => $raw,
        };

        return self::toUtf8($bytes, $charset);
    }

    public static function toUtf8(string $bytes, ?string $charset): string
    {
        $charset = strtolower(trim((string) $charset, " \t\"'"));

        if ($charset === '' || $charset === 'utf-8' || $charset === 'us-ascii') {
            return mb_scrub($bytes, 'UTF-8');
        }

        try {
            $converted = mb_convert_encoding($bytes, 'UTF-8', $charset);

            return mb_scrub($converted === false ? $bytes : $converted, 'UTF-8');
        } catch (ValueError) {
            // * Unknown charset name: keep what is valid UTF-8 rather than failing the whole message.
            return mb_scrub($bytes, 'UTF-8');
        }
    }
}
