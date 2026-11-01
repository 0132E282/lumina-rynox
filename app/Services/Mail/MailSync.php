<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Models\Mailbox;
use App\Models\MailFolder;
use App\Services\Mail\Exceptions\MailAuthException;
use App\Services\Mail\Exceptions\MailConnectionException;
use App\Services\Mail\Exceptions\MailException;
use App\Services\Mail\Exceptions\MailProtocolException;
use App\Services\Mail\Exceptions\MailTlsException;
use App\Services\Mail\Imap\ImapClient;
use App\Services\Mail\Imap\ImapSession;
use App\Services\Mail\Imap\MessageHeader;
use App\Services\Mail\Security\BlockedHostException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;

/**
 * Pulls INBOX and Sent of one mailbox into the DB cache. Read-only on the server except for pushing the user's own
 * read/unread changes (idempotent \Seen STORE). Spam/Junk and every other folder are never read.
 *
 * Callers hold the per-mailbox lock (see MailSyncCommand).
 */
final class MailSync
{
    private const SENT_NAMES = ['sent', 'sent items', 'sent mail', '[gmail]/sent mail'];

    private const CONFIG_ERROR = 'Cấu hình máy chủ không hợp lệ.';

    public function __construct(
        private readonly ImapClient $imap,
        private readonly MailBodyLoader $bodies,
    ) {}

    /**
     * @return int number of new messages cached; 0 when the sync failed (the failure is recorded on the mailbox)
     */
    public function syncMailbox(Mailbox $mailbox): int
    {
        try {
            $session = $this->imap->open($mailbox->imapConnection());
        } catch (MailException|InvalidArgumentException $exception) {
            $this->recordFailure($mailbox, $exception);

            return 0;
        }

        $new = 0;

        try {
            foreach ($this->folders($mailbox, $session) as $folder) {
                $new += $this->syncFolder($folder, $session);
            }
        } catch (MailException $exception) {
            $this->recordFailure($mailbox, $exception);

            return $new;
        } finally {
            $session->close();
        }

        $mailbox->forceFill([
            'status' => Mailbox::STATUS_CONNECTED,
            'last_error' => null,
            'auth_failed_at' => null,
            'last_synced_at' => now(),
            'next_sync_at' => now()->addMinutes($mailbox->sync_interval_minutes),
        ])->save();

        return $new;
    }

    /** @return list<MailFolder> INBOX, then Sent when the server has one */
    private function folders(Mailbox $mailbox, ImapSession $session): array
    {
        $folders = [MailFolder::query()->firstOrCreate(
            ['mailbox_id' => $mailbox->id, 'role' => MailFolder::ROLE_INBOX],
            ['name' => 'INBOX', 'last_uid' => 0],
        )];

        $sentName = $this->findSentName($session);

        if ($sentName !== null) {
            $sent = MailFolder::query()->firstOrNew(['mailbox_id' => $mailbox->id, 'role' => MailFolder::ROLE_SENT]);
            $sent->name = $sentName;
            // * A new row only has the attributes set here (DB defaults are not read back), so the cursor is set explicitly.
            $sent->last_uid ??= 0;
            $sent->save();
            $folders[] = $sent;
        }

        return $folders;
    }

    private function findSentName(ImapSession $session): ?string
    {
        $remote = $session->folders();

        foreach ($remote as $folder) {
            if ($folder->isSpecialUse('\\Sent')) {
                return $folder->name;
            }
        }

        foreach ($remote as $folder) {
            if (in_array(strtolower($folder->name), self::SENT_NAMES, true)) {
                return $folder->name;
            }
        }

        return null;
    }

    private function syncFolder(MailFolder $folder, ImapSession $session): int
    {
        $status = $session->select($folder->name);

        // * UIDVALIDITY changed: every stored UID is meaningless now, so the cache of this folder is rebuilt. This check runs
        // * before pushing flags so a stale UID can never STORE a flag onto a different message.
        if ($folder->uid_validity !== null && $folder->uid_validity !== $status->uidValidity) {
            $folder->messages()->delete();
            $folder->last_uid = 0;
        }

        $folder->uid_validity = $status->uidValidity;
        $folder->save();

        $this->pushDirtyFlags($folder, $session);

        $new = $this->fetchNew($folder, $session, $status->uidNext);
        $this->reconcile($folder, $session);

        $folder->synced_at = now();
        $folder->save();

        return $new;
    }

    private function pushDirtyFlags(MailFolder $folder, ImapSession $session): void
    {
        foreach ($folder->messages()->where('flags_dirty', true)->get(['id', 'uid', 'seen']) as $message) {
            $session->setSeen($message->uid, $message->seen);
            $message->forceFill(['flags_dirty' => false])->save();
        }
    }

    private function fetchNew(MailFolder $folder, ImapSession $session, int $uidNext): int
    {
        if ($folder->last_uid === 0) {
            $uids = $session->searchSince(now()->subDays((int) config('mailbox.initial_days')));
            // * Window: only the newest `initial_limit` UIDs.
            $uids = array_slice($uids, -max(1, (int) config('mailbox.initial_limit')));

            if ($uids === []) {
                // * Empty window: later syncs only look at UIDs above what exists now.
                $folder->last_uid = max(0, $uidNext - 1);
                $folder->save();

                return 0;
            }
        } else {
            $lastUid = $folder->last_uid;
            // * Servers answer `UID n:*` with the last message even when it is below n.
            $uids = array_values(array_filter(
                $session->searchUidRange($lastUid + 1),
                fn (int $uid): bool => $uid > $lastUid,
            ));
        }

        $new = 0;

        foreach (array_chunk($uids, max(1, (int) config('mailbox.batch_size'))) as $batch) {
            $new += $this->storeBatch($folder, $session, $batch);
            // * Saved per batch: a failure half-way resumes from here instead of re-fetching everything.
            $folder->last_uid = max($folder->last_uid, ...$batch);
            $folder->save();
        }

        return $new;
    }

    /** @param list<int> $uids */
    private function storeBatch(MailFolder $folder, ImapSession $session, array $uids): int
    {
        $rows = [];

        foreach ($session->fetchHeaders($uids) as $header) {
            $rows[] = $this->row($folder, $session, $header);
        }

        return $rows === [] ? 0 : DB::table('mail_messages')->insertOrIgnore($rows);
    }

    /** @return array<string, mixed> */
    private function row(MailFolder $folder, ImapSession $session, MessageHeader $header): array
    {
        $body = [];

        if ($header->size <= (int) config('mailbox.prefetch_max_bytes')) {
            try {
                $body = $this->bodies->attributesFor($session->fetchBody($header->uid, (int) config('mailbox.body_max_bytes')));
            } catch (MailProtocolException) {
                // * One unreadable message must not stop the batch; its body is loaded when it is opened.
                $body = [];
            }
        }

        $attachments = $body['attachments'] ?? $header->attachments;

        return [
            'mailbox_id' => $folder->mailbox_id,
            'mail_folder_id' => $folder->id,
            'uid' => $header->uid,
            'message_id' => $header->messageId,
            'in_reply_to' => $header->inReplyTo,
            'references' => $header->references === [] ? null : implode(' ', $header->references),
            'thread_key' => ThreadKey::for($header, $folder->id),
            'from_name' => $this->limit($header->fromName, 255),
            'from_email' => $this->limit($header->fromEmail, 255),
            'reply_to' => $this->json($header->replyTo),
            'to' => $this->json($header->to),
            'cc' => $this->json($header->cc),
            'subject' => $this->limit($header->subject, 998),
            'snippet' => $body['snippet'] ?? '',
            'sent_at' => $header->date?->utc()->toDateTimeString(),
            'received_at' => ($header->internalDate ?? $header->date ?? now())->utc()->toDateTimeString(),
            'seen' => $header->hasFlag('\\Seen'),
            'flagged' => $header->hasFlag('\\Flagged'),
            'answered' => $header->hasFlag('\\Answered'),
            'flags_dirty' => false,
            'has_attachments' => $body['has_attachments'] ?? $header->hasAttachments,
            'attachments' => $this->json($attachments),
            'size' => max(0, $header->size),
            'body_html' => $body['body_html'] ?? null,
            'body_text' => $body['body_text'] ?? null,
            'body_truncated' => $body['body_truncated'] ?? false,
            'body_fetched_at' => isset($body['body_fetched_at']) ? now()->toDateTimeString() : null,
            'created_at' => now()->toDateTimeString(),
            'updated_at' => now()->toDateTimeString(),
        ];
    }

    /**
     * Drops cached messages the server no longer has (deleted/moved there) and refreshes the flags of the newest ones.
     */
    private function reconcile(MailFolder $folder, ImapSession $session): void
    {
        $lowest = $folder->messages()->min('uid');

        if ($lowest === null) {
            return;
        }

        $remote = array_flip($session->searchUidRange((int) $lowest, $folder->last_uid));
        $gone = [];

        foreach ($folder->messages()->pluck('uid') as $uid) {
            if (! isset($remote[(int) $uid])) {
                $gone[] = (int) $uid;
            }
        }

        foreach (array_chunk($gone, 500) as $chunk) {
            $folder->messages()->whereIn('uid', $chunk)->delete();
        }

        $recent = $folder->messages()
            ->where('flags_dirty', false)
            ->orderByDesc('uid')
            ->limit((int) config('mailbox.flag_refresh_limit'))
            ->get(['id', 'uid', 'seen', 'flagged', 'answered']);

        if ($recent->isEmpty()) {
            return;
        }

        $uids = [];

        foreach ($recent as $message) {
            $uids[] = (int) $message->uid;
        }

        $flags = $session->fetchFlags($uids);

        foreach ($recent as $message) {
            if (! isset($flags[$message->uid])) {
                continue;
            }

            $current = $flags[$message->uid];
            $changes = [
                'seen' => in_array('\\Seen', $current, true),
                'flagged' => in_array('\\Flagged', $current, true),
                'answered' => in_array('\\Answered', $current, true),
            ];

            if ($changes !== ['seen' => $message->seen, 'flagged' => $message->flagged, 'answered' => $message->answered]) {
                $message->forceFill($changes)->save();
            }
        }
    }

    private function recordFailure(Mailbox $mailbox, MailException|InvalidArgumentException $exception): void
    {
        $isAuthLike = $exception instanceof MailAuthException || $exception instanceof InvalidArgumentException;

        $reason = match (true) {
            $exception instanceof MailAuthException => 'auth',
            $exception instanceof BlockedHostException => 'blocked',
            $exception instanceof MailTlsException => 'tls',
            $exception instanceof MailConnectionException => 'connection',
            $exception instanceof MailProtocolException => 'protocol',
            default => 'config',
        };

        // * Fixed sentence and ids only: never the exception message (it could hold a host or an address in other layers).
        Log::warning('Mail sync failed.', ['mailbox_id' => $mailbox->id, 'reason' => $reason]);

        $mailbox->forceFill([
            'status' => Mailbox::STATUS_ERROR,
            'last_error' => $exception instanceof InvalidArgumentException ? self::CONFIG_ERROR : $exception->getMessage(),
            // * BR-007: wrong password (or an unusable stored config) stops syncing until the user saves the mailbox again,
            // * so the provider never sees repeated bad logins. Network errors keep retrying on schedule.
            'auth_failed_at' => $isAuthLike ? now() : $mailbox->auth_failed_at,
            'next_sync_at' => now()->addMinutes($mailbox->sync_interval_minutes),
        ])->save();
    }

    /** @param  list<mixed>  $value */
    private function json(array $value): ?string
    {
        return $value === [] ? null : json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    private function limit(?string $value, int $length): ?string
    {
        return $value === null ? null : mb_substr($value, 0, $length);
    }
}
