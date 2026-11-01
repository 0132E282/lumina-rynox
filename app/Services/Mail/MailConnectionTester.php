<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Models\Mailbox;
use App\Services\Mail\Exceptions\MailException;
use App\Services\Mail\Imap\ImapClient;
use App\Services\Mail\Smtp\SmtpTransport;
use InvalidArgumentException;

/**
 * "Kiểm tra kết nối": logs in to IMAP and starts (does not send on) SMTP. Results are fixed sentences only.
 */
final class MailConnectionTester
{
    public function __construct(
        private readonly ImapClient $imap,
        private readonly SmtpTransport $smtp,
    ) {}

    public function test(MailboxConnection $imap, MailboxConnection $smtp): ConnectionTestResult
    {
        $imapError = $this->attempt(function () use ($imap): void {
            $this->imap->open($imap)->close();
        });

        $smtpError = $this->attempt(fn () => $this->smtp->start($smtp));

        return new ConnectionTestResult($imapError, $smtpError);
    }

    public function testMailbox(Mailbox $mailbox): ConnectionTestResult
    {
        try {
            return $this->test($mailbox->imapConnection(), $mailbox->smtpConnection());
        } catch (InvalidArgumentException $exception) {
            // * The stored port is not an allowed encrypted one: the message of this validation error is fixed text.
            return new ConnectionTestResult($exception->getMessage(), $exception->getMessage());
        }
    }

    private function attempt(callable $step): ?string
    {
        try {
            $step();

            return null;
        } catch (MailException $exception) {
            return $exception->getMessage();
        }
    }
}
