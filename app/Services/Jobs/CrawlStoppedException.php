<?php

declare(strict_types=1);

namespace App\Services\Jobs;

use RuntimeException;

/** The crawl of one source must stop: the site refused (403/429/captcha), robots.txt forbids the path, or it cannot be reached. Never retried or worked around. */
final class CrawlStoppedException extends RuntimeException
{
    public function __construct(public readonly string $status, string $message)
    {
        parent::__construct($message);
    }
}
