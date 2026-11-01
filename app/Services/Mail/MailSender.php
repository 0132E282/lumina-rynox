<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Models\Admin;
use App\Models\Mailbox;
use App\Models\MailMessage;
use App\Models\MailOutbox;
use App\Services\Mail\Exceptions\MailException;
use App\Services\Mail\Imap\ImapClient;
use App\Services\Mail\Imap\ImapSession;
use App\Services\Mail\Smtp\SmtpTransport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;
use Throwable;

/**
 * Sends a reply through the mailbox's own SMTP account, once per user click and never retried on its own (BR-002).
 *
 * `start` failing (connect/login) = nothing left the machine: `failed`, safe to retry. `send` failing = delivery had begun:
 * `unknown`, resending asks the user to confirm "may duplicate". The sender address is always the mailbox itself (BR-010).
 * Logs only a fixed sentence, the mailbox id and the exception class: never addresses, subjects or bodies.
 */
final class MailSender
{
    public const MAX_QUOTE_CHARACTERS = 20000;

    private const SEND_UNKNOWN = 'Không nhận được phản hồi từ máy chủ, thư có thể đã được gửi.';

    private const CONFIG_ERROR = 'Cấu hình máy chủ không hợp lệ.';

    private const START_ERROR = 'Không gửi được thư.';

    public function __construct(
        private readonly SmtpTransport $smtp,
        private readonly ImapClient $imap,
    ) {}

    /**
     * Same `client_token` as an earlier attempt returns that attempt untouched (double click, retried request).
     *
     * @param  array{to: list<string>, cc: list<string>, subject: string, body: string, client_token: string, quote_original: bool}  $input
     */
    public function reply(MailMessage $message, array $input, Admin $admin): MailOutbox
    {
        $mailbox = $message->mailbox;
        $now = now();

        $inserted = DB::table('mail_outbox')->insertOrIgnore([
            'mailbox_id' => $mailbox->id,
            'reply_to_message_id' => $message->id,
            'client_token' => $input['client_token'],
            'to' => json_encode($this->entries($input['to']), JSON_THROW_ON_ERROR),
            'cc' => $input['cc'] === [] ? null : json_encode($this->entries($input['cc']), JSON_THROW_ON_ERROR),
            'subject' => $this->subject($input['subject']),
            'body_text' => $input['body'].($input['quote_original'] ? $this->quote($message) : ''),
            'message_id' => Str::uuid()->toString().'@'.$this->domain($mailbox),
            'status' => MailOutbox::STATUS_SENDING,
            'sent_by' => $admin->id,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $outbox = MailOutbox::query()->where('mailbox_id', $mailbox->id)->where('client_token', $input['client_token'])->firstOrFail();

        if ($inserted === 1) {
            $this->deliver($outbox);
        }

        return $outbox;
    }

    /**
     * "Gửi lại" / "Thử lại". The claim is one atomic UPDATE, so two clicks can never send twice.
     *
     * @return MailOutbox|null null when the attempt is not in a state that can be resent (already sending or sent)
     */
    public function resend(MailOutbox $outbox): ?MailOutbox
    {
        $claimed = MailOutbox::query()
            ->whereKey($outbox->id)
            ->whereIn('status', [MailOutbox::STATUS_UNKNOWN, MailOutbox::STATUS_FAILED])
            ->update(['status' => MailOutbox::STATUS_SENDING, 'error' => null, 'updated_at' => now()]);

        if ($claimed === 0) {
            return null;
        }

        $outbox->refresh();
        $this->deliver($outbox);

        return $outbox;
    }

    private function deliver(MailOutbox $outbox): void
    {
        $mailbox = $outbox->mailbox;

        try {
            $connection = $mailbox->smtpConnection();
        } catch (InvalidArgumentException) {
            $this->finish($outbox, MailOutbox::STATUS_FAILED, self::CONFIG_ERROR);

            return;
        }

        try {
            $this->smtp->start($connection);
        } catch (MailException $exception) {
            $this->logFailure($mailbox, 'start', $exception);
            $this->finish($outbox, MailOutbox::STATUS_FAILED, $exception->getMessage());

            return;
        } catch (Throwable $exception) {
            $this->logFailure($mailbox, 'start', $exception);
            $this->finish($outbox, MailOutbox::STATUS_FAILED, self::START_ERROR);

            return;
        }

        $original = $outbox->replyToMessage;
        $email = $this->email($outbox, $mailbox, $original);

        try {
            $this->smtp->send($email);
        } catch (Throwable $exception) {
            // * Whatever went wrong after the message was handed over, the server may have accepted it.
            $this->logFailure($mailbox, 'send', $exception);
            $this->finish($outbox, MailOutbox::STATUS_UNKNOWN, self::SEND_UNKNOWN);

            return;
        }

        $this->finish($outbox, MailOutbox::STATUS_SENT, null, ['sent_at' => now()]);
        $this->afterSend($outbox, $mailbox, $original, $email);
    }

    /** @param array<string, mixed> $extra */
    private function finish(MailOutbox $outbox, string $status, ?string $error, array $extra = []): void
    {
        $outbox->forceFill(['status' => $status, 'error' => $error, ...$extra])->save();
    }

    /** Answered flag and the Sent copy are best effort: the mail is already out, so none of this can change its status. */
    private function afterSend(MailOutbox $outbox, Mailbox $mailbox, ?MailMessage $original, Email $email): void
    {
        $original?->forceFill(['answered' => true])->save();
        $wantsCopy = $mailbox->save_sent_copy;

        if (! $wantsCopy && $original === null) {
            return;
        }

        $saved = $wantsCopy ? false : null;

        try {
            $session = $this->imap->open($mailbox->imapConnection());

            try {
                if ($original !== null) {
                    $this->markAnswered($session, $original);
                }

                if ($wantsCopy) {
                    $saved = $this->appendSent($session, $mailbox, $email);
                }
            } finally {
                $session->close();
            }
        } catch (Throwable $exception) {
            $this->logFailure($mailbox, 'copy', $exception);
        }

        if ($saved !== $outbox->sent_copy_saved) {
            $outbox->forceFill(['sent_copy_saved' => $saved])->save();
        }
    }

    private function markAnswered(ImapSession $session, MailMessage $original): void
    {
        try {
            $folder = $original->folder;
            $status = $session->select($folder->name);

            // * A changed UIDVALIDITY means the stored UID may now be another message: leave the flag alone.
            if ($folder->uid_validity === null || $folder->uid_validity === $status->uidValidity) {
                $session->setAnswered($original->uid);
            }
        } catch (MailException) {
            // * Best effort; the next sync reads the server's flags anyway.
        }
    }

    private function appendSent(ImapSession $session, Mailbox $mailbox, Email $email): bool
    {
        $sentName = $mailbox->folders()->where('role', 'sent')->value('name');

        if (! is_string($sentName)) {
            return false;
        }

        try {
            $session->append($sentName, $email->toString());

            return true;
        } catch (MailException) {
            return false;
        }
    }

    private function email(MailOutbox $outbox, Mailbox $mailbox, ?MailMessage $original): Email
    {
        $email = (new Email)
            ->from(new Address($mailbox->email))
            ->to(...array_map(fn (string $address): Address => new Address($address), $this->addresses($outbox->to)))
            ->subject($outbox->subject)
            ->text($outbox->body_text)
            ->date($outbox->created_at?->toDateTimeImmutable() ?? now()->toDateTimeImmutable());

        $copies = $this->addresses($outbox->cc ?? []);

        if ($copies !== []) {
            $email->cc(...array_map(fn (string $address): Address => new Address($address), $copies));
        }

        $headers = $email->getHeaders();
        $headers->addIdHeader('Message-ID', (string) $outbox->message_id);

        if ($original !== null) {
            $parent = $this->validIds([$original->message_id ?? '']);
            $references = $this->validIds([...preg_split('/\s+/', trim((string) $original->references)) ?: [], ...$parent]);

            if ($parent !== []) {
                $headers->addIdHeader('In-Reply-To', $parent[0]);
            }

            if ($references !== []) {
                $headers->addIdHeader('References', $references);
            }
        }

        return $email;
    }

    /**
     * @param  list<string>  $addresses
     * @return list<array{name: null, email: string}>
     */
    private function entries(array $addresses): array
    {
        return array_map(fn (string $address): array => ['name' => null, 'email' => $address], $addresses);
    }

    /**
     * @param  array<int, mixed>  $stored
     * @return list<string>
     */
    private function addresses(array $stored): array
    {
        $addresses = [];

        foreach ($stored as $entry) {
            $address = is_array($entry) ? ($entry['email'] ?? null) : $entry;

            if (is_string($address) && $address !== '') {
                $addresses[] = $address;
            }
        }

        return $addresses;
    }

    /**
     * Message-IDs the header class accepts; a malformed id from a foreign mail is dropped rather than failing the reply.
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    private function validIds(array $ids): array
    {
        $valid = [];

        foreach ($ids as $id) {
            $id = trim($id, " \t\r\n<>");

            if ($id === '') {
                continue;
            }

            try {
                new Address($id);
            } catch (Throwable) {
                continue;
            }

            if (! in_array($id, $valid, true)) {
                $valid[] = $id;
            }
        }

        return $valid;
    }

    private function subject(string $subject): string
    {
        return preg_match('/^\s*re:/i', $subject) === 1 ? $subject : 'Re: '.$subject;
    }

    private function quote(MailMessage $message): string
    {
        $text = $message->body_text ?? trim(html_entity_decode(strip_tags((string) $message->body_html), ENT_QUOTES | ENT_HTML5));

        if ($text === '') {
            return '';
        }

        $who = trim(($message->from_name ?? '').' <'.($message->from_email ?? '').'>');
        $when = $message->received_at?->timezone((string) config('cms.personal_timezone', config('app.timezone')))->format('d/m/Y H:i');
        $quoted = collect(preg_split('/\R/', mb_substr($text, 0, self::MAX_QUOTE_CHARACTERS)) ?: [])
            ->map(fn (string $line): string => '> '.$line)
            ->implode("\n");

        return "\n\nVào {$when}, {$who} đã viết:\n{$quoted}";
    }

    private function domain(Mailbox $mailbox): string
    {
        $domain = Str::after($mailbox->email, '@');

        return $domain !== '' && $domain !== $mailbox->email ? $domain : 'localhost';
    }

    private function logFailure(Mailbox $mailbox, string $stage, Throwable $exception): void
    {
        Log::warning('Mail send failed.', ['mailbox_id' => $mailbox->id, 'stage' => $stage, 'exception' => $exception::class]);
    }
}
