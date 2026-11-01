<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class JobPosting extends Model
{
    public const STATUS_NEW = 'new';

    public const STATUS_SAVED = 'saved';

    public const STATUS_SKIPPED = 'skipped';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_APPLIED = 'applied';

    /**
     * * Allowed manual moves; `applied` is final. Staying on the same status (only editing the note) is handled by the controller.
     *
     * @var array<string, list<string>>
     */
    public const TRANSITIONS = [
        self::STATUS_NEW => [self::STATUS_SAVED, self::STATUS_SKIPPED, self::STATUS_APPROVED],
        self::STATUS_SAVED => [self::STATUS_NEW, self::STATUS_SKIPPED, self::STATUS_APPROVED],
        self::STATUS_SKIPPED => [self::STATUS_NEW, self::STATUS_SAVED],
        self::STATUS_APPROVED => [self::STATUS_SAVED, self::STATUS_SKIPPED, self::STATUS_APPLIED],
        self::STATUS_APPLIED => [],
    ];

    protected $fillable = [
        'source',
        'external_id',
        'url',
        'title',
        'company',
        'location',
        'salary_text',
        'tags',
        'posted_at',
        'first_seen_at',
        'last_seen_at',
        'meta',
        'application_status',
        'applied_at',
        'note',
    ];

    protected $casts = [
        'tags' => 'array',
        'meta' => 'array',
        'posted_at' => 'datetime',
        'first_seen_at' => 'datetime',
        'last_seen_at' => 'datetime',
        'applied_at' => 'datetime',
    ];
}
