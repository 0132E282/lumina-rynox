<?php

declare(strict_types=1);

namespace App\Services\Mail;

final class ConnectionTestResult
{
    /** @param string|null $imapError fixed sentence, null = IMAP login worked */
    public function __construct(
        public readonly ?string $imapError,
        public readonly ?string $smtpError,
    ) {}

    public function passed(): bool
    {
        return $this->imapError === null && $this->smtpError === null;
    }
}
