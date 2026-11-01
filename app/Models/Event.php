<?php

declare(strict_types=1);

namespace App\Models;

use App\Concerns\QueryBuilder;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Auth;

/**
 * @property int $id
 * @property int|null $admin_id
 * @property string $title
 * @property string $type
 * @property Carbon $date
 * @property string $starts_at `H:i`
 * @property string $ends_at `H:i`
 * @property string $repeat
 * @property string|null $location
 * @property array<int, int>|null $remind_before_minutes
 * @property array<int, string>|null $reminders_sent
 */
class Event extends Model
{
    use QueryBuilder;

    // * Read by `AuthorizeResource`: the generic items API requires `events.{view,create,update,delete}`.
    public const PERMISSION_RESOURCE = 'events';

    // * Read by `ItemController::defaultSearchFields()`.
    public const SEARCH_FIELDS = ['title', 'location'];

    public const TYPE_LIST = [
        'interview' => 'Phỏng vấn',
        'meeting' => 'Họp',
        'reminder' => 'Nhắc việc',
    ];

    public const REPEAT_LIST = [
        'none' => 'Không lặp',
        'daily' => 'Hằng ngày',
        'weekly' => 'Hằng tuần',
        'monthly' => 'Hằng tháng',
    ];

    // * Allowed "remind before" marks in minutes: 1 day and 30 minutes.
    public const REMIND_MARKS = [1440, 30];

    protected $fillable = [
        'title',
        'type',
        'date',
        'starts_at',
        'ends_at',
        'repeat',
        'location',
        'remind_before_minutes',
    ];

    protected $casts = [
        'date' => 'date:Y-m-d',
        'remind_before_minutes' => 'array',
        'reminders_sent' => 'array',
    ];

    protected $hidden = ['reminders_sent'];

    protected static function booted(): void
    {
        static::creating(function (Event $event) {
            $event->admin_id ??= (int) Auth::id() ?: null;
        });

        // * Moving or re-timing an event, or changing its marks, makes earlier "already reminded" records stale.
        static::updating(function (Event $event) {
            if ($event->isDirty(['date', 'starts_at', 'repeat', 'remind_before_minutes'])) {
                $event->reminders_sent = [];
            }
        });
    }

    /** * `time` columns come back as `H:i:s`; the app works in `H:i`. */
    /** @return Attribute<string|null, never> */
    protected function startsAt(): Attribute
    {
        return Attribute::make(get: fn (?string $value) => $value === null ? null : substr($value, 0, 5));
    }

    /** @return Attribute<string|null, never> */
    protected function endsAt(): Attribute
    {
        return Attribute::make(get: fn (?string $value) => $value === null ? null : substr($value, 0, 5));
    }

    /** @return BelongsTo<Admin, $this> */
    public function admin(): BelongsTo
    {
        return $this->belongsTo(Admin::class);
    }

    /**
     * * Every field is required: the form always sends the full event, and `ends_at` is compared with `starts_at`.
     *
     * @return array<string, array<int, string>>
     */
    public static function rules(mixed $ignoring = null): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'type' => ['required', 'in:'.implode(',', array_keys(self::TYPE_LIST))],
            'date' => ['required', 'date_format:Y-m-d'],
            'starts_at' => ['required', 'date_format:H:i'],
            'ends_at' => ['required', 'date_format:H:i', 'after_or_equal:starts_at'],
            'repeat' => ['required', 'in:'.implode(',', array_keys(self::REPEAT_LIST))],
            'location' => ['nullable', 'string', 'max:500'],
            'remind_before_minutes' => ['nullable', 'array', 'max:'.count(self::REMIND_MARKS)],
            'remind_before_minutes.*' => ['integer', 'distinct', 'in:'.implode(',', self::REMIND_MARKS)],
        ];
    }
}
