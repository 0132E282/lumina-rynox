<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One send attempt. Never sent automatically: only when the user presses Send (BR-002).
 *
 * @property int $id
 * @property int $mailbox_id
 * @property int|null $reply_to_message_id
 * @property string $client_token
 * @property list<array{name: string|null, email: string}> $to
 * @property list<array{name: string|null, email: string}>|null $cc
 * @property string $subject
 * @property string $body_text
 * @property string|null $message_id
 * @property string $status `sending|sent|unknown|failed`
 * @property string|null $error
 * @property bool|null $sent_copy_saved
 * @property int|null $sent_by
 * @property Carbon|null $sent_at
 */
class MailOutbox extends Model
{
    protected $table = 'mail_outbox';

    public const STATUS_SENDING = 'sending';

    public const STATUS_SENT = 'sent';

    // * Failed after delivery started (timeout/dropped): the mail may or may not have gone out; resend needs a "may duplicate" confirmation.
    public const STATUS_UNKNOWN = 'unknown';

    // * Failed before delivery started (connect/login): safe to retry.
    public const STATUS_FAILED = 'failed';

    // * A `sending` row older than this is shown as `unknown` (the request died mid-send).
    public const STALE_SENDING_MINUTES = 2;

    protected $fillable = [
        'mailbox_id',
        'reply_to_message_id',
        'client_token',
        'to',
        'cc',
        'subject',
        'body_text',
        'message_id',
        'status',
        'error',
        'sent_copy_saved',
        'sent_by',
        'sent_at',
    ];

    protected $casts = [
        'to' => 'array',
        'cc' => 'array',
        'sent_copy_saved' => 'boolean',
        'sent_at' => 'datetime',
    ];

    /** @return BelongsTo<Mailbox, $this> */
    public function mailbox(): BelongsTo
    {
        return $this->belongsTo(Mailbox::class);
    }

    /** @return BelongsTo<MailMessage, $this> */
    public function replyToMessage(): BelongsTo
    {
        return $this->belongsTo(MailMessage::class, 'reply_to_message_id');
    }

    /** * Status to show: a stale `sending` row is reported as `unknown`. `updated_at` is when the current attempt began (a resend claims the row again). */
    public function effectiveStatus(): string
    {
        $startedAt = $this->updated_at ?? $this->created_at;

        if ($this->status === self::STATUS_SENDING && $startedAt !== null
            && $startedAt->lte(now()->subMinutes(self::STALE_SENDING_MINUTES))) {
            return self::STATUS_UNKNOWN;
        }

        return $this->status;
    }
}
