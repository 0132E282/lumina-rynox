<?php

declare(strict_types=1);

namespace App\Models;

use App\Services\Mail\MailboxConnection;
use App\Services\Mail\MailServerAddress;
use Database\Factories\MailboxFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * An IMAP/SMTP mailbox. Deliberately NOT using `QueryBuilder` (no `PERMISSION_RESOURCE`/items API): it holds a password and is
 * only reachable through dedicated, permission-checked controllers.
 *
 * @property int $id
 * @property string|null $label
 * @property string $email
 * @property string $provider_preset `gmail|outlook|imap`
 * @property string $imap_host
 * @property int $imap_port
 * @property string $imap_encryption `ssl|starttls`
 * @property string $smtp_host
 * @property int $smtp_port
 * @property string $smtp_encryption `ssl|starttls`
 * @property string $username
 * @property array{password?: string}|null $credentials
 * @property int $sync_interval_minutes
 * @property bool $save_sent_copy
 * @property string $status `connected|error|disconnected`
 * @property string|null $last_error
 * @property Carbon|null $last_synced_at
 * @property Carbon|null $next_sync_at
 * @property Carbon|null $auth_failed_at
 */
class Mailbox extends Model
{
    /** @use HasFactory<MailboxFactory> */
    use HasFactory;

    public const STATUS_CONNECTED = 'connected';

    public const STATUS_ERROR = 'error';

    public const STATUS_DISCONNECTED = 'disconnected';

    public const STATUS_LABELS = [
        self::STATUS_CONNECTED => 'Đã kết nối',
        self::STATUS_ERROR => 'Lỗi kết nối',
        self::STATUS_DISCONNECTED => 'Chưa kết nối',
    ];

    public const PRESET_GMAIL = 'gmail';

    public const PRESET_OUTLOOK = 'outlook';

    public const PRESET_IMAP = 'imap';

    public const PRESETS = [self::PRESET_GMAIL, self::PRESET_OUTLOOK, self::PRESET_IMAP];

    public const SYNC_INTERVALS = [1, 5, 15, 30];

    protected $fillable = [
        'label',
        'email',
        'provider_preset',
        'imap_host',
        'imap_port',
        'imap_encryption',
        'smtp_host',
        'smtp_port',
        'smtp_encryption',
        'username',
        'credentials',
        'sync_interval_minutes',
        'save_sent_copy',
        'status',
        'last_error',
        'last_synced_at',
        'next_sync_at',
        'auth_failed_at',
    ];

    // ! Secrets never leave the server: `credentials` is hidden; clients only get a "has password" flag and `Integration::mask`.
    protected $hidden = ['credentials'];

    protected $casts = [
        'credentials' => 'encrypted:array',
        'imap_port' => 'integer',
        'smtp_port' => 'integer',
        'sync_interval_minutes' => 'integer',
        'save_sent_copy' => 'boolean',
        'last_synced_at' => 'datetime',
        'next_sync_at' => 'datetime',
        'auth_failed_at' => 'datetime',
    ];

    /** @return HasMany<MailFolder, $this> */
    public function folders(): HasMany
    {
        return $this->hasMany(MailFolder::class);
    }

    /** @return HasMany<MailMessage, $this> */
    public function messages(): HasMany
    {
        return $this->hasMany(MailMessage::class);
    }

    /** @return HasMany<MailOutbox, $this> */
    public function outbox(): HasMany
    {
        return $this->hasMany(MailOutbox::class);
    }

    public function password(): string
    {
        return ($this->credentials ?? [])['password'] ?? '';
    }

    public function hasPassword(): bool
    {
        return $this->password() !== '';
    }

    /**
     * Mailboxes `mail:sync` may open: connected, or failed for a reason that can heal by itself (network). A wrong-password
     * failure (`auth_failed_at`) is skipped until the credentials are saved again (BR-007).
     *
     * @param  Builder<Mailbox>  $query
     * @return Builder<Mailbox>
     */
    public function scopeSyncable(Builder $query): Builder
    {
        return $query
            ->whereIn('status', [self::STATUS_CONNECTED, self::STATUS_ERROR])
            ->whereNull('auth_failed_at');
    }

    public function isSyncable(): bool
    {
        return in_array($this->status, [self::STATUS_CONNECTED, self::STATUS_ERROR], true) && $this->auth_failed_at === null;
    }

    public function isDue(): bool
    {
        return $this->isSyncable() && ($this->next_sync_at === null || $this->next_sync_at->lte(now()));
    }

    /** * Clears a recorded failure so the next `mail:sync` tries again ("Thử lại" / credentials saved). */
    public function markForRetry(): void
    {
        $this->forceFill([
            'status' => self::STATUS_CONNECTED,
            'last_error' => null,
            'auth_failed_at' => null,
            'next_sync_at' => null,
        ])->save();
    }

    /** @throws \InvalidArgumentException when the stored host/port is not an allowed encrypted one */
    public function imapConnection(): MailboxConnection
    {
        return new MailboxConnection(
            MailServerAddress::make($this->imap_host, $this->imap_port, MailServerAddress::KIND_IMAP),
            $this->username,
            $this->password(),
        );
    }

    /** @throws \InvalidArgumentException */
    public function smtpConnection(): MailboxConnection
    {
        return new MailboxConnection(
            MailServerAddress::make($this->smtp_host, $this->smtp_port, MailServerAddress::KIND_SMTP),
            $this->username,
            $this->password(),
        );
    }
}
