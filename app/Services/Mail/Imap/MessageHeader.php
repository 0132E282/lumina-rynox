<?php

declare(strict_types=1);

namespace App\Services\Mail\Imap;

use Carbon\CarbonImmutable;

final class MessageHeader
{
    /**
     * @param  list<string>  $references  Message-IDs without angle brackets
     * @param  list<array{name: string|null, email: string}>  $replyTo
     * @param  list<array{name: string|null, email: string}>  $to
     * @param  list<array{name: string|null, email: string}>  $cc
     * @param  list<string>  $flags  e.g. `\Seen`, `\Flagged`, `\Answered`
     * @param  list<array{name: string, mime: string, size: int}>  $attachments
     */
    public function __construct(
        public readonly int $uid,
        public readonly ?string $messageId = null,
        public readonly ?string $inReplyTo = null,
        public readonly array $references = [],
        public readonly ?string $fromName = null,
        public readonly ?string $fromEmail = null,
        public readonly array $replyTo = [],
        public readonly array $to = [],
        public readonly array $cc = [],
        public readonly ?string $subject = null,
        public readonly ?CarbonImmutable $date = null,
        public readonly ?CarbonImmutable $internalDate = null,
        public readonly array $flags = [],
        public readonly int $size = 0,
        public readonly bool $hasAttachments = false,
        public readonly array $attachments = [],
    ) {}

    public function hasFlag(string $flag): bool
    {
        foreach ($this->flags as $candidate) {
            if (strcasecmp($candidate, $flag) === 0) {
                return true;
            }
        }

        return false;
    }
}
