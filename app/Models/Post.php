<?php

declare(strict_types=1);

namespace App\Models;

use App\Concerns\QueryBuilder;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * @property int $id
 * @property int|null $admin_id
 * @property string|null $title
 * @property string $body
 * @property array<int, array{url: string, type: string}>|null $media
 * @property Carbon|null $scheduled_at
 * @property string $status
 */
class Post extends Model
{
    use QueryBuilder;

    // * Read by `AuthorizeResource`: the generic items API requires `posts.{view,create,update,delete}`.
    public const PERMISSION_RESOURCE = 'posts';

    // * Read by `ItemController::defaultSearchFields()`.
    public const SEARCH_FIELDS = ['title', 'body'];

    public const STATUS_DRAFT = 'draft';

    public const STATUS_SCHEDULED = 'scheduled';

    public const STATUS_PUBLISHING = 'publishing';

    public const STATUS_PUBLISHED = 'published';

    public const STATUS_PARTIAL = 'partial';

    public const STATUS_FAILED = 'failed';

    public const STATUS_MISSED = 'missed';

    public const STATUS_LIST = [
        self::STATUS_DRAFT => 'Nháp',
        self::STATUS_SCHEDULED => 'Đã lên lịch',
        self::STATUS_PUBLISHING => 'Đang đăng',
        self::STATUS_PUBLISHED => 'Đã đăng',
        self::STATUS_PARTIAL => 'Đăng một phần',
        self::STATUS_FAILED => 'Lỗi đăng',
        self::STATUS_MISSED => 'Đã lỡ lịch',
    ];

    // * Platforms and schedule can only change while nothing has been (or is being) sent; the content stays editable in every state but `publishing`.
    public const EDITABLE_STATUSES = [self::STATUS_DRAFT, self::STATUS_SCHEDULED];

    public const MAX_BODY_LENGTH = 3000;

    public const MAX_MEDIA = 10;

    protected $fillable = [
        'title',
        'body',
        'media',
        'scheduled_at',
    ];

    protected $casts = [
        'media' => 'array',
        'scheduled_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (Post $post) {
            $post->admin_id ??= (int) Auth::id() ?: null;
        });

        // * Backs the generic items API too: a post that is being or has been sent keeps its content.
        static::updating(function (Post $post) {
            $original = (string) $post->getOriginal('status');

            if ($post->isDirty(['title', 'body', 'media', 'scheduled_at']) && $original === self::STATUS_PUBLISHING) {
                throw ValidationException::withMessages(['body' => 'Bài viết đang được đăng, chưa thể sửa.']);
            }
        });

        static::deleting(function (Post $post) {
            if ($post->status === self::STATUS_PUBLISHING) {
                throw ValidationException::withMessages(['status' => 'Bài viết đang được đăng, chưa thể xoá.']);
            }
        });
    }

    /** @return BelongsTo<Admin, $this> */
    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }

    /** @return HasMany<PostTarget, $this> */
    public function targets(): HasMany
    {
        return $this->hasMany(PostTarget::class)->orderBy('id');
    }

    /** * The text, title and media can be corrected in every state except while the post is being sent (platforms and schedule only while `isEditable()`). */
    public function isContentEditable(): bool
    {
        return $this->status !== self::STATUS_PUBLISHING;
    }

    public function isEditable(): bool
    {
        return in_array($this->status, self::EDITABLE_STATUSES, true);
    }

    /**
     * * Derives the post status from its targets once none is pending or publishing: all published, none published (failed),
     * * or a mix (partial). `unknown` counts as not published. Returns the settled status, or null while work is in flight.
     */
    public function refreshStatus(): ?string
    {
        $counts = PostTarget::query()
            ->where('post_id', $this->id)
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $total = (int) $counts->sum();

        if ($total === 0 || (int) ($counts[PostTarget::STATUS_PENDING] ?? 0) + (int) ($counts[PostTarget::STATUS_PUBLISHING] ?? 0) > 0) {
            return null;
        }

        $published = (int) ($counts[PostTarget::STATUS_PUBLISHED] ?? 0);
        $status = match (true) {
            $published === $total => self::STATUS_PUBLISHED,
            $published === 0 => self::STATUS_FAILED,
            default => self::STATUS_PARTIAL,
        };

        // * Status is system-owned (not fillable) and the content guard must not fire, so write it directly.
        self::query()->whereKey($this->id)->update(['status' => $status, 'updated_at' => now()]);
        $this->status = $status;
        $this->syncOriginal();

        return $status;
    }

    /**
     * * Rules for the generic items API. The post form (`SavePostRequest`) adds platform-specific checks on top.
     *
     * @return array<string, array<int, string>>
     */
    public static function rules(mixed $ignoring = null): array
    {
        return [
            'title' => ['nullable', 'string', 'max:255'],
            'body' => [$ignoring === null ? 'required' : 'sometimes', 'string', 'max:'.self::MAX_BODY_LENGTH],
            'media' => ['nullable', 'array', 'max:'.self::MAX_MEDIA],
            'media.*.url' => ['required', 'url:http,https', 'max:2048'],
            'media.*.type' => ['required', 'in:image,video'],
            'scheduled_at' => ['nullable', 'date'],
        ];
    }
}
