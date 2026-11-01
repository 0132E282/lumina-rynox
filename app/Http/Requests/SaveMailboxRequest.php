<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Models\Mailbox;
use App\Services\Mail\MailboxConnection;
use App\Services\Mail\MailServerAddress;
use App\Services\Mail\Security\BlockedHostException;
use App\Services\Mail\Security\MailHostGuard;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use InvalidArgumentException;
use SensitiveParameter;

/**
 * * Create/update form of a mailbox, also used by "Kiểm tra kết nối" (`mail.accounts.test`, which may name a stored mailbox with `mailbox_id`).
 * * Servers arrive as `host:port`; only encrypted ports and public hosts pass (BR-005, BR-006). The user name is the address itself.
 */
class SaveMailboxRequest extends FormRequest
{
    // * Permission is enforced by the `AuthorizeResource` route middleware (`integrations.update`).
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $current = $this->currentMailbox();
        $unique = Rule::unique('mailboxes', 'email')->ignore($current?->id);

        return [
            'provider_preset' => ['required', Rule::in(Mailbox::PRESETS)],
            'email' => ['required', 'string', 'email:rfc', 'max:255', ...($this->isConnectionTest() ? [] : [$unique])],
            // * Leaving the password blank keeps the stored one; it is only mandatory while there is none to keep.
            'password' => [$current?->hasPassword() ? 'nullable' : 'required', 'string', 'max:1000'],
            'imap' => ['required', 'string', 'max:255', $this->serverRule(MailServerAddress::KIND_IMAP)],
            'smtp' => ['required', 'string', 'max:255', $this->serverRule(MailServerAddress::KIND_SMTP)],
            'sync_interval_minutes' => ['required', 'integer', Rule::in(Mailbox::SYNC_INTERVALS)],
            'save_sent_copy' => ['required', 'boolean'],
        ];
    }

    /** @return array<string, string> */
    public function attributes(): array
    {
        return [
            'email' => 'địa chỉ email',
            'password' => 'mật khẩu ứng dụng',
            'imap' => 'máy chủ IMAP',
            'smtp' => 'máy chủ SMTP',
            'sync_interval_minutes' => 'tần suất đồng bộ',
            'provider_preset' => 'nhà cung cấp',
        ];
    }

    /** @return array<string, mixed> columns of `mailboxes` for create/update; `credentials` only when a new password was typed */
    public function mailboxAttributes(): array
    {
        $imap = MailServerAddress::parse((string) $this->validated('imap'), MailServerAddress::KIND_IMAP);
        $smtp = MailServerAddress::parse((string) $this->validated('smtp'), MailServerAddress::KIND_SMTP);
        $email = strtolower(trim((string) $this->validated('email')));

        $attributes = [
            'provider_preset' => $this->validated('provider_preset'),
            'email' => $email,
            'username' => $email,
            'imap_host' => $imap->host,
            'imap_port' => $imap->port,
            'imap_encryption' => $imap->encryption,
            'smtp_host' => $smtp->host,
            'smtp_port' => $smtp->port,
            'smtp_encryption' => $smtp->encryption,
            'sync_interval_minutes' => (int) $this->validated('sync_interval_minutes'),
            'save_sent_copy' => (bool) $this->validated('save_sent_copy'),
        ];

        if (filled($this->validated('password'))) {
            $attributes['credentials'] = ['password' => (string) $this->validated('password')];
        }

        return $attributes;
    }

    /**
     * Connections for the "Kiểm tra kết nối" form data; a blank password falls back to the stored one.
     *
     * @return array{0: MailboxConnection, 1: MailboxConnection} IMAP, then SMTP
     */
    public function connections(): array
    {
        $email = strtolower(trim((string) $this->validated('email')));
        $password = filled($this->validated('password')) ? (string) $this->validated('password') : ($this->currentMailbox()?->password() ?? '');

        return [
            $this->connection(MailServerAddress::KIND_IMAP, 'imap', $email, $password),
            $this->connection(MailServerAddress::KIND_SMTP, 'smtp', $email, $password),
        ];
    }

    /** @param 'imap'|'smtp' $kind */
    private function connection(string $kind, string $field, string $email, #[SensitiveParameter] string $password): MailboxConnection
    {
        return new MailboxConnection(MailServerAddress::parse((string) $this->validated($field), $kind), $email, $password);
    }

    private function currentMailbox(): ?Mailbox
    {
        $routed = $this->route('mailbox');

        if ($routed instanceof Mailbox) {
            return $routed;
        }

        $id = $this->input('mailbox_id');

        return is_numeric($id) ? Mailbox::query()->find((int) $id) : null;
    }

    private function isConnectionTest(): bool
    {
        return $this->routeIs('mail.accounts.test');
    }

    /** @param 'imap'|'smtp' $kind */
    private function serverRule(string $kind): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($kind): void {
            try {
                $address = MailServerAddress::parse((string) $value, $kind);
                app(MailHostGuard::class)->assertPublic($address->host);
            } catch (InvalidArgumentException|BlockedHostException $exception) {
                // * Both carry fixed, user-safe sentences (never the host).
                $fail($exception->getMessage());
            }
        };
    }
}
