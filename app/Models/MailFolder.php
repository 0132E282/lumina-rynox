<?php

declare(strict_types=1);

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property int $mailbox_id
 * @property string $role `inbox|sent`
 * @property string $name Real server-side folder name
 * @property int|null $uid_validity
 * @property int $last_uid
 * @property CarbonInterface|null $synced_at
 */
class MailFolder extends Model
{
    public const ROLE_INBOX = 'inbox';

    public const ROLE_SENT = 'sent';

    protected $fillable = ['mailbox_id', 'role', 'name', 'uid_validity', 'last_uid', 'synced_at'];

    protected $casts = [
        'uid_validity' => 'integer',
        'last_uid' => 'integer',
        'synced_at' => 'datetime',
    ];

    /** @return BelongsTo<Mailbox, $this> */
    public function mailbox(): BelongsTo
    {
        return $this->belongsTo(Mailbox::class);
    }

    /** @return HasMany<MailMessage, $this> */
    public function messages(): HasMany
    {
        return $this->hasMany(MailMessage::class);
    }
}
