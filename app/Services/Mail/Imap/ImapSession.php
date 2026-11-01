<?php

declare(strict_types=1);

namespace App\Services\Mail\Imap;

use App\Services\Mail\Exceptions\MailException;
use DateTimeInterface;

/**
 * One logged-in IMAP session. Nothing here deletes or moves mail on the server (BR-001); reading never sets \Seen (peek).
 *
 * @throws MailException every method
 */
interface ImapSession
{
    /** @return list<RemoteFolder> */
    public function folders(): array;

    /** * Opens the folder read-write (needed to STORE flags). */
    public function select(string $folder): FolderStatus;

    /** @return list<int> UIDs of messages received on/after the date, ascending */
    public function searchSince(DateTimeInterface $since): array;

    /**
     * UIDs in `from..to` (`to` null = up to the newest). Servers may answer with the last UID even when it is below `from`.
     *
     * @return list<int> ascending
     */
    public function searchUidRange(int $from, ?int $to = null): array;

    /**
     * Headers, flags, internal date and size; no body.
     *
     * @param  list<int>  $uids
     * @return list<MessageHeader>
     */
    public function fetchHeaders(array $uids): array;

    /**
     * @param  list<int>  $uids
     * @return array<int, list<string>> uid => flags (e.g. `\Seen`)
     */
    public function fetchFlags(array $uids): array;

    /** * Body by peek (does not set \Seen), cut at about `$maxBytes`; attachments are listed, never downloaded. */
    public function fetchBody(int $uid, int $maxBytes): MessageBody;

    /** * Idempotent: `+FLAGS`/`-FLAGS \Seen` by UID in the selected folder. */
    public function setSeen(int $uid, bool $seen): void;

    /** * Idempotent: `+FLAGS \Answered` by UID in the selected folder (after the user replied). */
    public function setAnswered(int $uid): void;

    /** * Appends a raw RFC 822 message (already CRLF) to a folder, flagged \Seen. */
    public function append(string $folder, string $rawMime): void;

    public function close(): void;
}
