<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $ai_conversation_id
 * @property string $role `user|assistant`
 * @property string $content plain text
 * @property Carbon $created_at
 */
class AiMessage extends Model
{
    public const ROLE_USER = 'user';

    public const ROLE_ASSISTANT = 'assistant';

    public const MAX_CONTENT_LENGTH = 20000;

    protected $fillable = ['ai_conversation_id', 'role', 'content'];

    /** @return BelongsTo<AiConversation, $this> */
    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AiConversation::class, 'ai_conversation_id');
    }

    /** @return HasMany<AiChangeProposal, $this> */
    public function proposals(): HasMany
    {
        return $this->hasMany(AiChangeProposal::class)->orderBy('id');
    }
}
