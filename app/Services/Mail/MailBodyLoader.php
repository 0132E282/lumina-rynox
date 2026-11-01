<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Models\MailMessage;
use App\Services\Mail\Exceptions\MailException;
use App\Services\Mail\Imap\ImapClient;
use App\Services\Mail\Imap\ImapSession;
use App\Services\Mail\Imap\MessageBody;
use InvalidArgumentException;

/**
 * Loads a message body when the user opens it (one IMAP session for the body and the \Seen flag) and keeps the read/unread
 * state in step with the server. The body is fetched by peek, sanitised, capped and stored; attachment content is never fetched.
 */
final class MailBodyLoader
{
    private const CONFIG_ERROR = 'Cấu hình máy chủ không hợp lệ.';

    private const CHANGED_ERROR = 'Thư đã thay đổi trên máy chủ, hãy đồng bộ lại.';

    public function __construct(
        private readonly ImapClient $imap,
        private readonly HtmlBodySanitizer $sanitizer,
    ) {}

    public function open(MailMessage $message): MailOpenResult
    {
        $needsBody = $message->body_fetched_at === null;
        $needsSeen = ! $message->seen;

        if (! $needsBody && ! $needsSeen) {
            return new MailOpenResult($message);
        }

        $body = null;
        $flagsSynced = true;

        try {
            $session = $this->session($message);
        } catch (MailException|InvalidArgumentException $exception) {
            return $this->unreachable($message, $needsBody, $this->sentence($exception));
        }

        try {
            if (! $this->select($message, $session)) {
                return new MailOpenResult($message, true, self::CHANGED_ERROR);
            }

            if ($needsBody) {
                try {
                    $body = $session->fetchBody($message->uid, $this->maxBytes());
                } catch (MailException $exception) {
                    // * Nothing was changed on the server (peek), so \Seen is left alone as well.
                    return new MailOpenResult($message, true, $exception->getMessage());
                }
            }

            if ($needsSeen) {
                $flagsSynced = $this->pushSeen($session, $message, true);
            }
        } catch (MailException $exception) {
            // * Selecting the folder failed: the connection dropped after login.
            return $this->unreachable($message, $needsBody, $exception->getMessage());
        } finally {
            $session->close();
        }

        $attributes = $body === null ? [] : $this->attributesFor($body);

        if ($needsSeen) {
            $attributes['seen'] = true;
            $attributes['flags_dirty'] = ! $flagsSynced;
        }

        if ($body !== null && ($attributes['snippet'] ?? '') === '') {
            unset($attributes['snippet']);
        }

        $message->forceFill($attributes)->save();

        return new MailOpenResult($message, $flagsSynced);
    }

    /**
     * "Đánh dấu chưa đọc". The local flag always changes; the return value says whether the server was updated too.
     */
    public function markUnread(MailMessage $message): bool
    {
        $synced = true;

        try {
            $session = $this->session($message);

            try {
                $synced = $this->select($message, $session) && $this->pushSeen($session, $message, false);
            } finally {
                $session->close();
            }
        } catch (MailException|InvalidArgumentException) {
            $synced = false;
        }

        $message->forceFill(['seen' => false, 'flags_dirty' => ! $synced])->save();

        return $synced;
    }

    /**
     * Row attributes for a fetched body: sanitised HTML, capped text, attachment metadata, snippet. The single place HTML is
     * sanitised before storage; `MailSync` uses it for its prefetch as well.
     *
     * @return array<string, mixed>
     */
    public function attributesFor(MessageBody $body): array
    {
        $max = $this->maxBytes();
        $truncated = $body->truncated;

        $text = $body->text;
        $html = $body->html;

        if ($text !== null && strlen($text) > $max) {
            $text = mb_strcut($text, 0, $max);
            $truncated = true;
        }

        if ($html !== null && strlen($html) > $max) {
            $html = mb_strcut($html, 0, $max);
            $truncated = true;
        }

        $safeHtml = $html !== null && trim($html) !== '' ? $this->sanitizer->sanitize($html) : null;
        $attachments = $this->attachments($body);

        return [
            'body_html' => $safeHtml,
            'body_text' => $text,
            'body_truncated' => $truncated,
            'attachments' => $attachments,
            'has_attachments' => $attachments !== [],
            'snippet' => Snippet::make($text, $safeHtml),
            'body_fetched_at' => now(),
        ];
    }

    /** @return list<array{name: string, mime: string, size: int}> */
    private function attachments(MessageBody $body): array
    {
        return array_map(fn (array $attachment): array => [
            'name' => mb_substr(trim(preg_replace('/[\x00-\x1F\x7F]+/u', '', mb_scrub($attachment['name'])) ?? ''), 0, 255) ?: 'attachment',
            'mime' => mb_substr(strtolower(preg_replace('/[^\w.+\/-]/', '', $attachment['mime']) ?? ''), 0, 100),
            'size' => max(0, $attachment['size']),
        ], $body->attachments);
    }

    private function session(MailMessage $message): ImapSession
    {
        return $this->imap->open($message->mailbox->imapConnection());
    }

    /** * False when the folder's UIDVALIDITY changed: the stored UID would now point at another message (or none). */
    private function select(MailMessage $message, ImapSession $session): bool
    {
        $folder = $message->folder;
        $status = $session->select($folder->name);

        return $folder->uid_validity === null || $folder->uid_validity === $status->uidValidity;
    }

    private function pushSeen(ImapSession $session, MailMessage $message, bool $seen): bool
    {
        try {
            $session->setSeen($message->uid, $seen);

            return true;
        } catch (MailException) {
            return false;
        }
    }

    private function unreachable(MailMessage $message, bool $needsBody, string $error): MailOpenResult
    {
        if ($needsBody) {
            return new MailOpenResult($message, true, $error);
        }

        // * Body already cached: the user can still read it; only the server-side \Seen is pending.
        $message->forceFill(['seen' => true, 'flags_dirty' => true])->save();

        return new MailOpenResult($message, false);
    }

    private function sentence(MailException|InvalidArgumentException $exception): string
    {
        return $exception instanceof MailException ? $exception->getMessage() : self::CONFIG_ERROR;
    }

    private function maxBytes(): int
    {
        return (int) config('mailbox.body_max_bytes');
    }
}
