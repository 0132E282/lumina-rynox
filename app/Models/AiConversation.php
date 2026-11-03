<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * * One AI chat thread of the home page. Always read through `AiConversation::query()->ownedBy($user)`, so another admin's thread is simply not found.
 *
 * @property int $id internal only
 * @property string $uuid public id used in URLs and the API
 * @property int $user_id
 * @property string $title first message, truncated
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class AiConversation extends Model
{
    public const TITLE_LENGTH = 60;

    protected $fillable = ['user_id', 'title', 'repo', 'parent_id'];

    protected static function booted(): void
    {
        static::creating(function (AiConversation $conversation): void {
            $conversation->uuid ??= (string) Str::uuid();
        });
    }

    /** @param  Builder<AiConversation>  $query */
    public function scopeOwnedBy(Builder $query, Admin $user): void
    {
        $query->where('user_id', $user->id);
    }

    /** @return BelongsTo<Admin, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(Admin::class, 'user_id');
    }

    /** @return HasMany<AiMessage, $this> */
    public function messages(): HasMany
    {
        return $this->hasMany(AiMessage::class);
    }
}
