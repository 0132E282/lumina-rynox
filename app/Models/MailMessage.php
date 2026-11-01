<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\MailMessageFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A cached message. Not using `QueryBuilder` on purpose (see `Mailbox`).
 *
 * @property int $id
 * @property int $mailbox_id
 * @property int $mail_folder_id
 * @property int $uid
 * @property string|null $message_id
 * @property string|null $in_reply_to
 * @property string|null $references
 * @property string $thread_key
 * @property string|null $from_name
 * @property string|null $from_email
 * @property list<array{name: string|null, email: string}>|null $reply_to
 * @property list<array{name: string|null, email: string}>|null $to
 * @property list<array{name: string|null, email: string}>|null $cc
 * @property string|null $subject
 * @property string $snippet
 * @property Carbon|null $sent_at
 * @property Carbon|null $received_at
 * @property bool $seen
 * @property bool $flagged
 * @property bool $answered
 * @property bool $flags_dirty
 * @property bool $has_attachments
 * @property list<array{name: string, mime: string, size: int}>|null $attachments
 * @property int $size
 * @property string|null $body_html Already sanitised (HtmlBodySanitizer)
 * @property string|null $body_text
 * @property bool $body_truncated
 * @property Carbon|null $body_fetched_at
 */
class MailMessage extends Model
{
    /** @use HasFactory<MailMessageFactory> */
    use HasFactory;

    // * `mail.view` reads, `mail.send` replies; checked by routes via `AuthorizeResource::class.':mail,view|send'`.
    // * The model has no `QueryBuilder`, so the generic items API cannot reach it regardless.
    public const PERMISSION_RESOURCE = 'mail';

    protected $fillable = [
        'mailbox_id',
        'mail_folder_id',
        'uid',
        'message_id',
        'in_reply_to',
        'references',
        'thread_key',
        'from_name',
        'from_email',
        'reply_to',
        'to',
        'cc',
        'subject',
        'snippet',
        'sent_at',
        'received_at',
        'seen',
        'flagged',
        'answered',
        'flags_dirty',
        'has_attachments',
        'attachments',
        'size',
        'body_html',
        'body_text',
        'body_truncated',
        'body_fetched_at',
    ];

    protected $casts = [
        'uid' => 'integer',
        'reply_to' => 'array',
        'to' => 'array',
        'cc' => 'array',
        'attachments' => 'array',
        'sent_at' => 'datetime',
        'received_at' => 'datetime',
        'seen' => 'boolean',
        'flagged' => 'boolean',
        'answered' => 'boolean',
        'flags_dirty' => 'boolean',
        'has_attachments' => 'boolean',
        'size' => 'integer',
        'body_truncated' => 'boolean',
        'body_fetched_at' => 'datetime',
    ];

    /** @return BelongsTo<Mailbox, $this> */
    public function mailbox(): BelongsTo
    {
        return $this->belongsTo(Mailbox::class);
    }

    /** @return BelongsTo<MailFolder, $this> */
    public function folder(): BelongsTo
    {
        return $this->belongsTo(MailFolder::class, 'mail_folder_id');
    }

    /**
     * @param  Builder<MailMessage>  $query
     * @return Builder<MailMessage>
     */
    public function scopeInbox(Builder $query): Builder
    {
        return $query->whereHas('folder', fn (Builder $folder) => $folder->where('role', MailFolder::ROLE_INBOX));
    }

    /**
     * @param  Builder<MailMessage>  $query
     * @return Builder<MailMessage>
     */
    public function scopeSent(Builder $query): Builder
    {
        return $query->whereHas('folder', fn (Builder $folder) => $folder->where('role', MailFolder::ROLE_SENT));
    }
}
