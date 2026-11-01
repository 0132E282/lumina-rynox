<?php

declare(strict_types=1);

namespace App\Services\Jobs;

use Carbon\CarbonImmutable;

final readonly class CrawledJob
{
    /**
     * @param  list<string>  $tags
     * @param  array<string, scalar|null>  $meta
     */
    public function __construct(
        public string $externalId,
        public string $url,
        public string $title,
        public ?string $company,
        public ?string $location,
        public ?string $salaryText,
        public array $tags,
        public ?CarbonImmutable $postedAt,
        public array $meta = [],
    ) {}
}
