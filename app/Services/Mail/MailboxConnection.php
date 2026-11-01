<?php

declare(strict_types=1);

namespace App\Services\Mail;

use LogicException;
use SensitiveParameter;

/**
 * Everything needed to open one IMAP or one SMTP session. The password is held in memory only: the object cannot be
 * serialised, cast to a string, or dumped with it.
 */
final class MailboxConnection
{
    public function __construct(
        public readonly MailServerAddress $server,
        public readonly string $username,
        #[SensitiveParameter] private readonly string $password,
    ) {}

    public function password(): string
    {
        return $this->password;
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['server' => $this->server->toString(), 'username' => '***', 'password' => '***'];
    }

    /** @return array<string, mixed> */
    public function __serialize(): array
    {
        throw new LogicException('MailboxConnection must not be serialised.');
    }
}
