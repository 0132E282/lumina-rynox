<?php

declare(strict_types=1);

namespace App\Services\Mail\Smtp;

use App\Services\Mail\Exceptions\MailAuthException;
use App\Services\Mail\Exceptions\MailConnectionException;
use App\Services\Mail\Exceptions\MailException;
use App\Services\Mail\Exceptions\MailProtocolException;
use App\Services\Mail\Exceptions\MailTlsException;
use App\Services\Mail\MailboxConnection;
use Symfony\Component\Mime\Email;

/**
 * Two phases so the caller can tell "nothing was delivered" from "may have been delivered":
 * `start` (connect + EHLO + STARTTLS + AUTH) failing means nothing was sent (status `failed`, safe to retry);
 * `send` failing means delivery had begun (status `unknown`, resend needs a "may duplicate" confirmation).
 */
interface SmtpTransport
{
    /**
     * @throws MailAuthException|MailConnectionException|MailTlsException|MailException before anything is sent
     */
    public function start(MailboxConnection $connection): void;

    /**
     * @throws MailProtocolException|MailConnectionException the outcome is unknown: the server may have accepted the message
     */
    public function send(Email $email): void;
}
