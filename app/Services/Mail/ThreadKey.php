<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Services\Mail\Imap\MessageHeader;

final class ThreadKey
{
    /**
     * sha1 of the thread's root Message-ID: the first of References, else In-Reply-To, else the message's own id.
     * A message with none of them gets a key unique to its folder and UID.
     */
    public static function for(MessageHeader $header, int $folderId): string
    {
        foreach ([$header->references[0] ?? null, $header->inReplyTo, $header->messageId] as $candidate) {
            $root = self::normalise($candidate);

            if ($root !== '') {
                return sha1($root);
            }
        }

        return sha1("uid:{$folderId}:{$header->uid}");
    }

    public static function normalise(?string $messageId): string
    {
        return strtolower(trim((string) $messageId, " \t\r\n<>"));
    }
}
