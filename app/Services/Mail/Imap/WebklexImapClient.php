<?php

declare(strict_types=1);

namespace App\Services\Mail\Imap;

use App\Services\Mail\Exceptions\MailAuthException;
use App\Services\Mail\Exceptions\MailConnectionException;
use App\Services\Mail\Exceptions\MailException;
use App\Services\Mail\Exceptions\MailTlsException;
use App\Services\Mail\MailboxConnection;
use App\Services\Mail\MailServerAddress;
use App\Services\Mail\Security\MailHostGuard;
use Throwable;
use Webklex\PHPIMAP\ClientManager;
use Webklex\PHPIMAP\Connection\Protocols\ImapProtocol;
use Webklex\PHPIMAP\Exceptions\ConnectionFailedException;

/**
 * IMAP over webklex/php-imap's pure-PHP protocol (no ext-imap). Always encrypted with the certificate verified; every
 * library exception is mapped to a fixed-message mail exception and never wrapped, so no host or address can leak.
 *
 * Not covered by automated tests against a real server (only the fake); see docs/plans/email-management-20261027.json.
 */
final class WebklexImapClient implements ImapClient
{
    public function __construct(private readonly MailHostGuard $hostGuard) {}

    public function open(MailboxConnection $connection): ImapSession
    {
        $this->hostGuard->assertPublic($connection->server->host);

        $client = (new ClientManager(['options' => ['uid_cache' => false]]))->make([
            'host' => $connection->server->host,
            'port' => $connection->server->port,
            // * `ssl` = implicit TLS (993); `starttls` = upgrade after greeting (143). There is no plain-text option.
            'encryption' => $connection->server->encryption === MailServerAddress::ENCRYPTION_SSL ? 'ssl' : 'starttls',
            // ! Never disabled and not user-configurable.
            'validate_cert' => true,
            'username' => $connection->username,
            'password' => $connection->password(),
            'protocol' => 'imap',
            'authentication' => null,
            'timeout' => (int) config('mailbox.connect_timeout'),
        ]);

        try {
            $client->connect();
        } catch (ConnectionFailedException $exception) {
            throw $this->classifyConnectionFailure($exception);
        } catch (Throwable) {
            // * The socket opened and TLS succeeded; what fails after that in `connect()` is the LOGIN reply (NO/BAD/BYE).
            throw MailAuthException::make();
        }

        $protocol = $client->getConnection();

        if (! $protocol instanceof ImapProtocol) {
            throw MailConnectionException::unreachable();
        }

        return new WebklexImapSession($client, $protocol);
    }

    private function classifyConnectionFailure(Throwable $exception): MailException
    {
        $text = '';

        for ($current = $exception; $current !== null; $current = $current->getPrevious()) {
            $text .= ' '.strtolower($current->getMessage());
        }

        // * Read only to choose a fixed sentence; the text itself is discarded.
        return match (true) {
            str_contains($text, 'certificate') || str_contains($text, 'verify') => MailTlsException::certificate(),
            str_contains($text, 'tls') || str_contains($text, 'ssl') || str_contains($text, 'crypto') => MailTlsException::unsupported(),
            str_contains($text, 'timed out') || str_contains($text, 'timeout') => MailConnectionException::timeout(),
            default => MailConnectionException::unreachable(),
        };
    }
}
