<?php

declare(strict_types=1);

namespace App\Services\Jobs;

use Illuminate\Support\Str;

/**
 * ! No parser: on 2026-10-27 the public search page answered 403 (Cloudflare "Attention Required") to a plain, honestly identified
 * ! request, so there was no real HTML to verify selectors against. This crawler only probes once, reports the block, and never
 * ! invents a parser. Write `parse()` here only after a response that is actually served has been inspected.
 */
final class TopCvCrawler extends AbstractJobCrawler
{
    public function source(): string
    {
        return 'topcv';
    }

    public function crawl(JobCriteria $criteria): CrawlResult
    {
        if ($criteria->isEmpty()) {
            return parent::crawl($criteria);
        }

        try {
            $this->fetch($this->searchPath($criteria->keywords[0], 1));
        } catch (CrawlStoppedException $stopped) {
            return new CrawlResult($stopped->status, $stopped->getMessage());
        }

        return new CrawlResult(CrawlResult::STATUS_UNSUPPORTED, 'TopCV truy cập được nhưng chưa có bộ đọc HTML đã xác minh nên không lưu việc làm.');
    }

    protected function baseUrl(): string
    {
        return (string) config('jobs.sources.topcv.base_url');
    }

    protected function searchPath(string $keyword, int $page): string
    {
        return '/tim-viec-lam-'.Str::slug($keyword).($page > 1 ? '?page='.$page : '');
    }

    protected function parse(string $html): array
    {
        return [];
    }
}
