<?php

declare(strict_types=1);

namespace App\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $post_id
 * @property string $provider
 * @property int|null $social_group_id
 * @property string $audience
 * @property string $status
 * @property string|null $external_post_id
 * @property string|null $external_url
 * @property string|null $error
 * @property Carbon|null $published_at
 * @property int $attempts
 */
class PostTarget extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_PUBLISHING = 'publishing';

    public const STATUS_PUBLISHED = 'published';

    public const STATUS_FAILED = 'failed';

    public const STATUS_UNKNOWN = 'unknown';

    public const STATUS_LIST = [
        self::STATUS_PENDING => 'Chờ đăng',
        self::STATUS_PUBLISHING => 'Đang đăng',
        self::STATUS_PUBLISHED => 'Đã đăng',
        self::STATUS_FAILED => 'Lỗi',
        self::STATUS_UNKNOWN => 'Chưa chắc chắn',
    ];

    // * Only a manual retry may leave these two states.
    public const RETRYABLE_STATUSES = [self::STATUS_FAILED, self::STATUS_UNKNOWN];

    public const AUDIENCE_SELF = 'self';

    public const AUDIENCE_FRIENDS = 'friends';

    public const AUDIENCE_PUBLIC = 'public';

    public const AUDIENCE_CONNECTIONS = 'connections';

    // * Every audience any platform knows; each platform allows its own subset (config `posting.providers.*.audiences`, first = default).
    public const AUDIENCES = [self::AUDIENCE_SELF, self::AUDIENCE_FRIENDS, self::AUDIENCE_PUBLIC, self::AUDIENCE_CONNECTIONS];

    protected $fillable = ['post_id', 'provider', 'social_group_id', 'audience'];

    protected $casts = [
        'published_at' => 'datetime',
        'attempts' => 'integer',
    ];

    /** @return BelongsTo<Post, $this> */
    public function post(): BelongsTo
    {
        return $this->belongsTo(Post::class);
    }

    /** @return BelongsTo<SocialGroup, $this> */
    public function group(): BelongsTo
    {
        return $this->belongsTo(SocialGroup::class, 'social_group_id');
    }

    public function canRetry(): bool
    {
        return in_array($this->status, self::RETRYABLE_STATUSES, true);
    }
}
