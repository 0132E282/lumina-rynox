<?php

declare(strict_types=1);

namespace App\Services\Ai;

/** * The image types the code viewer can show (as a data URL in an img tag, so an SVG never runs scripts). */
final class ImageFiles
{
    private const MIMES = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml'];

    /** The GitHub contents API answers a file inline up to 1 MB, and the viewer reads local files up to the same size. */
    public const MAX_BYTES = 1_000_000;

    public static function mime(string $path): ?string
    {
        return self::MIMES[strtolower(pathinfo($path, PATHINFO_EXTENSION))] ?? null;
    }

    /** @param  string  $bytes  raw file content */
    public static function dataUrl(string $mime, string $bytes): string
    {
        return 'data:'.$mime.';base64,'.base64_encode($bytes);
    }
}
