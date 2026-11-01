<?php

declare(strict_types=1);

namespace App\Services\Mail;

final class Snippet
{
    public const LENGTH = 200;

    /** * One line of preview text: plain text if there is any, else the (already sanitised) HTML stripped of tags. */
    public static function make(?string $text, ?string $html): string
    {
        $source = trim((string) $text) !== '' ? (string) $text : html_entity_decode(strip_tags((string) $html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $collapsed = trim(preg_replace('/\s+/u', ' ', mb_scrub($source)) ?? '');

        return mb_substr($collapsed, 0, self::LENGTH);
    }
}
