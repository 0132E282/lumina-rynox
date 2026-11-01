<?php

declare(strict_types=1);

namespace App\Services\Jobs;

interface JobCrawler
{
    /** Source key, same as the Integration provider (`topcv`, `itviec`). */
    public function source(): string;

    /** Never throws for a block or a failed request: the outcome is in the result. */
    public function crawl(JobCriteria $criteria): CrawlResult;
}
