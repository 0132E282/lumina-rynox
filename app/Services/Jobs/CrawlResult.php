<?php

declare(strict_types=1);

namespace App\Services\Jobs;

final readonly class CrawlResult
{
    public const STATUS_OK = 'ok';

    // * 403/429/captcha: the source is left alone for `jobs.blocked_cooldown_hours`.
    public const STATUS_BLOCKED = 'blocked';

    // * robots.txt disallows the search path.
    public const STATUS_DISALLOWED = 'disallowed';

    // * No verified parser for this site.
    public const STATUS_UNSUPPORTED = 'unsupported';

    public const STATUS_NO_CRITERIA = 'no_criteria';

    public const STATUS_ERROR = 'error';

    // * Not a crawl outcome: the Integration turned the source off (permission `fetch_jobs` unticked) or the cooldown is running.
    public const STATUS_SKIPPED = 'skipped';

    /** @param list<CrawledJob> $jobs Jobs found before a stop are kept, so a block halfway still saves what was read. */
    public function __construct(
        public string $status,
        public string $message,
        public array $jobs = [],
    ) {}
}
