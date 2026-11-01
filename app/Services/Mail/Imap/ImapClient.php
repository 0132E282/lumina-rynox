<?php

declare(strict_types=1);

namespace App\Services\Mail\Imap;

use App\Services\Mail\Exceptions\MailException;
use App\Services\Mail\MailboxConnection;

interface ImapClient
{
    /**
     * Connects (encrypted, certificate verified, host guard applied) and logs in.
     *
     * @throws MailException one of the fixed-message mail exceptions; never a raw library exception
     */
    public function open(MailboxConnection $connection): ImapSession;
}
