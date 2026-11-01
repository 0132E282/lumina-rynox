<?php

declare(strict_types=1);

namespace App\Services\Mail\Imap;

final class MessageBody
{
    /**
     * @param  string|null  $html  RAW (unsanitised) HTML as sent; callers must pass it through HtmlBodySanitizer before storing
     * @param  list<array{name: string, mime: string, size: int}>  $attachments  metadata only
     */
    public function __construct(
        public readonly ?string $text = null,
        public readonly ?string $html = null,
        public readonly array $attachments = [],
        public readonly bool $truncated = false,
    ) {}
}
