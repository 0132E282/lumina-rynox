<?php

declare(strict_types=1);

namespace App\Services\Jobs\Alerts;

final readonly class ParsedAlertJob
{
    public function __construct(
        public string $url,
        public string $title,
        public ?string $company,
        public ?string $location,
        public ?string $salaryText,
    ) {}
}
