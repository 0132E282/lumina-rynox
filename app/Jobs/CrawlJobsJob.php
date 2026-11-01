<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Models\Cv;
use App\Services\Jobs\CvLatexWriter;
use App\Services\Jobs\JobCrawlService;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\Cache;

/**
 * * Used with `dispatchAfterResponse()` from "Tìm ngay" and the CV's "Tìm việc", so the page answers at once and no queue worker is needed
 * * (a crawl plus one AI call per new job takes far longer than a request should). The outcome lands in the setting `jobs_crawl`, which "Nơi tìm việc" shows.
 * * `cvId` set = "Tìm việc" of that CV; otherwise the sources switched on (or just `source`). One run at a time and never retried:
 * * a repeat would read the site and spend AI quota twice.
 */
final class CrawlJobsJob
{
    use Dispatchable;

    private const LOCK_SECONDS = 900;

    public function __construct(public readonly ?string $source = null, public readonly ?int $cvId = null) {}

    public function handle(JobCrawlService $service, CvLatexWriter $latex): void
    {
        $cv = $this->cvId === null ? null : Cv::query()->find($this->cvId);

        if ($this->cvId !== null && $cv === null) {
            return;
        }

        // * A second click while a run is still going simply gives up.
        Cache::lock('jobs-crawl', self::LOCK_SECONDS)->get(function () use ($service, $latex, $cv): void {
            if ($cv === null) {
                $service->run($this->source);

                return;
            }

            $service->runForCv($cv);
            // * Scoring is done: bring the CV's LaTeX text up to date (only when the person has not edited it).
            $latex->refresh($cv->refresh());
        });
    }
}
