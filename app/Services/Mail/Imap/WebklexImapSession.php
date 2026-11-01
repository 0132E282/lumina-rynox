<?php

declare(strict_types=1);

namespace App\Services\Mail\Imap;

use App\Services\Mail\Exceptions\MailConnectionException;
use App\Services\Mail\Exceptions\MailException;
use App\Services\Mail\Exceptions\MailProtocolException;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Throwable;
use Webklex\PHPIMAP\Client;
use Webklex\PHPIMAP\Config;
use Webklex\PHPIMAP\Connection\Protocols\ImapProtocol;
use Webklex\PHPIMAP\Exceptions\ConnectionFailedException;
use Webklex\PHPIMAP\Exceptions\RuntimeException as ImapRuntimeException;
use Webklex\PHPIMAP\Header;
use Webklex\PHPIMAP\IMAP;

/**
 * Talks to the server through the low-level `ImapProtocol` of webklex/php-imap, because its high-level API cannot do what the
 * module needs: it fetches `RFC822.TEXT` (which sets \Seen, then unsets it) instead of `BODY.PEEK`, has no BODYSTRUCTURE and
 * no UIDVALIDITY accessor. Quoted-string-heavy answers (INTERNALDATE, BODYSTRUCTURE) are read raw and parsed here because the
 * library's line decoder mis-splits a quoted string that is directly followed by `)`.
 */
final class WebklexImapSession implements ImapSession
{
    private ?Config $headerConfig = null;

    public function __construct(
        private readonly Client $client,
        private readonly ImapProtocol $protocol,
    ) {}

    public function folders(): array
    {
        /** @var array<string, array{delimiter: string, flags: array<mixed>}> $list */
        $list = $this->run(fn (): mixed => $this->protocol->folders('', '*')->validatedData());
        $folders = [];

        foreach ($list as $name => $info) {
            $folders[] = new RemoteFolder((string) $name, array_map('strval', array_values($info['flags'])));
        }

        return $folders;
    }

    public function select(string $folder): FolderStatus
    {
        /** @var array<string, mixed> $result */
        $result = $this->run(fn (): mixed => $this->protocol->selectFolder($folder)->validatedData());

        if (! isset($result['uidvalidity'], $result['uidnext'])) {
            throw MailProtocolException::make();
        }

        return new FolderStatus((int) $result['uidvalidity'], (int) $result['uidnext'], (int) ($result['exists'] ?? 0));
    }

    public function searchSince(DateTimeInterface $since): array
    {
        return $this->search(['SINCE', $since->format('d-M-Y')]);
    }

    public function searchUidRange(int $from, ?int $to = null): array
    {
        return $this->search(['UID', $from.':'.($to === null ? '*' : $to)]);
    }

    public function fetchHeaders(array $uids): array
    {
        if ($uids === []) {
            return [];
        }

        $meta = $this->fetchMeta($uids);

        /** @var array<int|string, array<string, mixed>> $rawHeaders */
        $rawHeaders = $this->run(fn (): mixed => $this->protocol->fetch(['UID', 'BODY.PEEK[HEADER]'], $uids, null, IMAP::ST_UID)->validatedData());

        $headers = [];

        foreach ($uids as $uid) {
            $raw = $this->section($rawHeaders[$uid] ?? []);

            if (! is_string($raw) || ! isset($meta[$uid])) {
                continue;
            }

            $headers[] = $this->makeHeader($uid, $raw, $meta[$uid]);
        }

        return $headers;
    }

    public function fetchFlags(array $uids): array
    {
        $flags = [];

        foreach ($this->fetchMeta($uids) as $uid => $meta) {
            $flags[$uid] = $meta['flags'];
        }

        return $flags;
    }

    public function fetchBody(int $uid, int $maxBytes): MessageBody
    {
        /** @var list<string> $lines */
        $lines = $this->run(fn (): mixed => $this->protocol->requestAndResponse('UID FETCH', [(string) $uid, '(UID BODYSTRUCTURE)'], true)->data());
        $leaves = BodyStructureParser::leaves(implode('', array_map('strval', $lines)));

        if ($leaves === []) {
            throw MailProtocolException::make();
        }

        $attachments = [];
        $htmlLeaf = null;
        $textLeaf = null;

        foreach ($leaves as $leaf) {
            if ($this->isAttachment($leaf)) {
                $attachments[] = [
                    'name' => $leaf['filename'] ?? 'attachment',
                    'mime' => $leaf['type'].'/'.$leaf['subtype'],
                    // * Declared encoded size; good enough to show "about how big".
                    'size' => $leaf['size'],
                ];

                continue;
            }

            if ($leaf['type'] === 'text' && $leaf['subtype'] === 'html') {
                $htmlLeaf ??= $leaf;
            } elseif ($leaf['type'] === 'text' && $leaf['subtype'] === 'plain') {
                $textLeaf ??= $leaf;
            }
        }

        $truncated = false;
        $html = $htmlLeaf === null ? null : $this->fetchPart($uid, $htmlLeaf, $maxBytes, $truncated);
        $text = $textLeaf === null ? null : $this->fetchPart($uid, $textLeaf, $maxBytes, $truncated);

        return new MessageBody($text, $html, $attachments, $truncated);
    }

    public function setSeen(int $uid, bool $seen): void
    {
        $this->run(fn (): mixed => $this->protocol->store(['\\Seen'], $uid, null, $seen ? '+' : '-', true, IMAP::ST_UID));
    }

    public function setAnswered(int $uid): void
    {
        $this->run(fn (): mixed => $this->protocol->store(['\\Answered'], $uid, null, '+', true, IMAP::ST_UID));
    }

    public function append(string $folder, string $rawMime): void
    {
        $this->run(fn (): mixed => $this->protocol->appendMessage($folder, $rawMime, ['\\Seen']));
    }

    public function close(): void
    {
        try {
            $this->client->disconnect();
        } catch (Throwable) {
            // * Closing is best effort: the work is already done, and a dead socket needs no further handling.
        }
    }

    /**
     * @param  list<string>  $criteria
     * @return list<int>
     */
    private function search(array $criteria): array
    {
        /** @var mixed $result */
        $result = $this->run(fn (): mixed => $this->protocol->search($criteria, IMAP::ST_UID)->data());
        $uids = [];

        foreach (is_array($result) ? $result : [] as $value) {
            if (is_scalar($value) && ctype_digit((string) $value)) {
                $uids[] = (int) $value;
            }
        }

        sort($uids);

        return $uids;
    }

    /**
     * @param  list<int>  $uids
     * @return array<int, array{flags: list<string>, internal: CarbonImmutable|null, size: int}>
     */
    private function fetchMeta(array $uids): array
    {
        if ($uids === []) {
            return [];
        }

        /** @var list<string> $lines */
        $lines = $this->run(fn (): mixed => $this->protocol->requestAndResponse('UID FETCH', [$this->uidSet($uids), '(UID FLAGS INTERNALDATE RFC822.SIZE)'], true)->data());
        $meta = [];

        foreach ($lines as $line) {
            if (preg_match('/\bUID (\d+)/', $line, $uid) !== 1) {
                continue;
            }

            $flags = preg_match('/FLAGS \(([^)]*)\)/', $line, $flagMatch) === 1
                ? array_values(array_filter(preg_split('/\s+/', trim($flagMatch[1])) ?: []))
                : [];

            $internal = null;

            if (preg_match('/INTERNALDATE "([^"]+)"/', $line, $dateMatch) === 1) {
                try {
                    $internal = CarbonImmutable::parse(trim($dateMatch[1]));
                } catch (Throwable) {
                    $internal = null;
                }
            }

            $meta[(int) $uid[1]] = [
                'flags' => $flags,
                'internal' => $internal,
                'size' => preg_match('/RFC822\.SIZE (\d+)/', $line, $sizeMatch) === 1 ? (int) $sizeMatch[1] : 0,
            ];
        }

        return $meta;
    }

    /**
     * @param  array{flags: list<string>, internal: CarbonImmutable|null, size: int}  $meta
     */
    private function makeHeader(int $uid, string $rawHeader, array $meta): MessageHeader
    {
        $header = new Header($rawHeader, $this->headerConfig ??= Config::make());

        $from = $this->addresses($header, 'from')[0] ?? null;
        $contentType = strtolower((string) $header->get('content_type')->first());
        $date = $header->get('date')->first();

        return new MessageHeader(
            uid: $uid,
            messageId: $this->scalar($header, 'message_id'),
            inReplyTo: $this->scalar($header, 'in_reply_to'),
            references: array_values(array_filter(array_map(
                fn (mixed $reference): string => trim((string) $reference),
                (array) $header->get('references')->toArray(),
            ), fn (string $reference): bool => $reference !== '')),
            fromName: $from['name'] ?? null,
            fromEmail: $from['email'] ?? null,
            replyTo: $this->addresses($header, 'reply_to'),
            to: $this->addresses($header, 'to'),
            cc: $this->addresses($header, 'cc'),
            subject: $this->scalar($header, 'subject'),
            date: $date instanceof DateTimeInterface ? CarbonImmutable::createFromInterface($date) : null,
            internalDate: $meta['internal'],
            flags: $meta['flags'],
            size: $meta['size'],
            // * Heuristic from the top-level type only (no BODYSTRUCTURE per message while syncing); exact list is read on open.
            hasAttachments: str_starts_with($contentType, 'multipart/mixed')
                || str_starts_with($contentType, 'application/')
                || str_starts_with($contentType, 'audio/')
                || str_starts_with($contentType, 'video/'),
        );
    }

    private function scalar(Header $header, string $name): ?string
    {
        $value = $header->get($name)->first();

        return is_scalar($value) && trim((string) $value) !== '' ? trim((string) $value) : null;
    }

    /** @return list<array{name: string|null, email: string}> */
    private function addresses(Header $header, string $name): array
    {
        $addresses = [];

        foreach ($header->get($name)->all() as $address) {
            $email = (string) ($address->mail ?? '');

            if ($email !== '') {
                $personal = trim((string) ($address->personal ?? ''));
                $addresses[] = ['name' => $personal === '' ? null : $personal, 'email' => $email];
            }
        }

        return $addresses;
    }

    /**
     * @param  array{path: string, type: string, subtype: string, encoding: string, charset: string|null, size: int, disposition: string|null, filename: string|null, hasContentId: bool}  $leaf
     */
    private function isAttachment(array $leaf): bool
    {
        if ($leaf['disposition'] === 'attachment') {
            return true;
        }

        $isBodyText = $leaf['type'] === 'text' && in_array($leaf['subtype'], ['plain', 'html'], true);

        if ($isBodyText) {
            return false;
        }

        // * Inline pictures referenced by Content-ID (signatures, newsletters) are part of the body, not attachments.
        if ($leaf['type'] === 'image' && $leaf['hasContentId'] && $leaf['disposition'] !== 'attachment') {
            return false;
        }

        return true;
    }

    /**
     * @param  array{path: string, type: string, subtype: string, encoding: string, charset: string|null, size: int, disposition: string|null, filename: string|null, hasContentId: bool}  $leaf
     */
    private function fetchPart(int $uid, array $leaf, int $maxBytes, bool &$truncated): string
    {
        // * Base64 and quoted-printable inflate the text by at most ~1.4x; ask for a little more than the decoded cap.
        $rawLimit = (int) ceil($maxBytes * 1.4) + 8;
        $item = "BODY.PEEK[{$leaf['path']}]<0.{$rawLimit}>";

        /** @var array<int|string, array<string, mixed>> $result */
        $result = $this->run(fn (): mixed => $this->protocol->fetch(['UID', $item], [$uid], null, IMAP::ST_UID)->validatedData());

        $raw = $this->section($result[$uid] ?? []);

        if ($raw === null) {
            return '';
        }

        $decoded = PartDecoder::decode($raw, $leaf['encoding'], $leaf['charset']);

        if ($leaf['size'] > $rawLimit || strlen($decoded) > $maxBytes) {
            $truncated = true;
        }

        return mb_strcut($decoded, 0, $maxBytes);
    }

    /**
     * The literal of the `BODY[...]` item in one FETCH answer (the key echoes the request, e.g. `BODY[1.1]<0>`).
     *
     * @param  array<string, mixed>  $fetched
     */
    private function section(array $fetched): ?string
    {
        foreach ($fetched as $key => $value) {
            if (str_starts_with(strtoupper((string) $key), 'BODY[') && is_string($value)) {
                return $value;
            }
        }

        return null;
    }

    /** @param list<int> $uids */
    private function uidSet(array $uids): string
    {
        return implode(',', array_map('intval', $uids));
    }

    /**
     * Runs one protocol call and turns any library failure into a fixed-message mail exception.
     *
     * @template T
     *
     * @param  callable(): T  $call
     * @return T
     */
    private function run(callable $call): mixed
    {
        try {
            return $call();
        } catch (MailException $exception) {
            throw $exception;
        } catch (ImapRuntimeException|ConnectionFailedException) {
            // * "empty response" / "failed to write": the stream timed out or the server dropped the connection.
            throw MailConnectionException::timeout();
        } catch (Throwable) {
            throw MailProtocolException::make();
        }
    }
}
