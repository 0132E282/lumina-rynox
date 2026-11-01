<?php

declare(strict_types=1);

namespace App\Services\Mail\Smtp;

use App\Services\Mail\Exceptions\MailAuthException;
use App\Services\Mail\Exceptions\MailConnectionException;
use App\Services\Mail\Exceptions\MailException;
use App\Services\Mail\Exceptions\MailProtocolException;
use App\Services\Mail\Exceptions\MailTlsException;
use App\Services\Mail\MailboxConnection;
use App\Services\Mail\MailServerAddress;
use App\Services\Mail\Security\MailHostGuard;
use LogicException;
use Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport;
use Symfony\Component\Mailer\Transport\Smtp\Stream\SocketStream;
use Symfony\Component\Mime\Email;
use Throwable;

/**
 * One EsmtpTransport per send (never the app's global mailer or /settings/smtp). Implicit TLS on 465; on 587 STARTTLS is
 * REQUIRED (no downgrade to plain text) and the certificate is always verified.
 *
 * Not covered by automated tests against a real server (only the fake).
 */
final class SymfonySmtpTransport implements SmtpTransport
{
    private ?EsmtpTransport $transport = null;

    public function __construct(private readonly MailHostGuard $hostGuard) {}

    public function start(MailboxConnection $connection): void
    {
        $this->hostGuard->assertPublic($connection->server->host);

        $server = $connection->server;
        $transport = new EsmtpTransport($server->host, $server->port, $server->encryption === MailServerAddress::ENCRYPTION_SSL);
        $transport->setRequireTls(true);
        $transport->setUsername($connection->username);
        $transport->setPassword($connection->password());

        $stream = $transport->getStream();

        if ($stream instanceof SocketStream) {
            $stream->setTimeout((float) config('mailbox.connect_timeout'));
            // ! Verification stays on; `peer_name` makes STARTTLS (a plain socket upgraded later) check the hostname too.
            $stream->setStreamOptions(['ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
                'peer_name' => $server->host,
                'crypto_method' => STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT,
            ]]);
        }

        try {
            $transport->start();
        } catch (Throwable $exception) {
            throw $this->classifyStartFailure($exception);
        }

        $this->transport = $transport;
    }

    public function send(Email $email): void
    {
        if ($this->transport === null) {
            throw new LogicException('SmtpTransport::start() must succeed before send().');
        }

        try {
            $this->transport->send($email);
        } catch (Throwable) {
            // * The exception text can hold addresses; the caller only needs to know delivery may have begun.
            throw MailProtocolException::make();
        } finally {
            try {
                $this->transport->stop();
            } catch (Throwable) {
                // * Best effort: the result was already decided above.
            }
        }
    }

    private function classifyStartFailure(Throwable $exception): MailException
    {
        $text = '';

        for ($current = $exception; $current !== null; $current = $current->getPrevious()) {
            $text .= ' '.strtolower($current->getMessage());
        }

        // * Read only to choose a fixed sentence; the text itself is discarded.
        return match (true) {
            str_contains($text, 'authenticat') => MailAuthException::make(),
            str_contains($text, 'certificate') || str_contains($text, 'verify') => MailTlsException::certificate(),
            str_contains($text, 'tls') || str_contains($text, 'ssl') || str_contains($text, 'crypto') => MailTlsException::unsupported(),
            str_contains($text, 'timed out') || str_contains($text, 'timeout') => MailConnectionException::timeout(),
            default => MailConnectionException::unreachable(),
        };
    }
}
