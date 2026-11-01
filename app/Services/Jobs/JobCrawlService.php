<?php

declare(strict_types=1);

namespace App\Services\Jobs;

use App\Models\Cv;
use App\Models\JobPosting;
use App\Models\Setting;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Date;

/**
 * Runs the crawlers of the sources switched on at "Nơi tìm việc" and stores what they read, then has the AI score new jobs against the
 * CV. The keywords are the CV's own "Từ khoá tìm kiếm" (the `position` column; the AI proposes them when a CV file is uploaded; the default CV, or the CV whose "Tìm việc" button was pressed); there is no
 * account or credential. The last outcome per source is kept in the setting `jobs_crawl` for the page.
 */
class JobCrawlService
{
    private const UPSERT_CHUNK = 200;

    public const ENABLED_KEY = 'jobs_sources_enabled';

    public const STATE_KEY = 'jobs_crawl';

    public function __construct(private readonly JobMatchService $matcher) {}

    /** @return list<string> */
    public function sources(): array
    {
        return array_keys((array) config('jobs.sources'));
    }

    /** @return list<string> */
    public function enabled(): array
    {
        return array_values(array_intersect($this->sources(), (array) Setting::get(self::ENABLED_KEY, [])));
    }

    public function setEnabled(string $source, bool $on): void
    {
        $keys = array_diff($this->enabled(), [$source]);

        Setting::set(self::ENABLED_KEY, array_values($on ? [...$keys, $source] : $keys));
    }

    /** @return array<string, array{status: string, message: string, count: int, at: string}> */
    public function states(): array
    {
        return (array) Setting::get(self::STATE_KEY, []);
    }

    /**
     * @return array<string, CrawlResult> source => outcome
     */
    public function run(?string $source = null, bool $force = false): array
    {
        $enabled = $this->enabled();
        $keys = $source === null ? $this->sources() : array_values(array_intersect($this->sources(), [$source]));
        $criteria = null;
        $results = [];

        foreach ($keys as $key) {
            $results[$key] = in_array($key, $enabled, true)
                ? $this->runSource($key, $force, $criteria ??= $this->defaultCriteria(), null)
                : new CrawlResult(CrawlResult::STATUS_SKIPPED, 'Nơi tìm việc đang tắt.');
        }

        return $results;
    }

    /**
     * "Tìm việc" of one CV: ITviec searched with that CV's search keywords and every new job scored against that same CV.
     * Pressing it is an explicit request, so it does not need the source switched on.
     */
    public function runForCv(Cv $cv, string $source = 'itviec'): CrawlResult
    {
        $criteria = JobCriteria::parse($cv->position);

        if ($criteria->isEmpty()) {
            return new CrawlResult(CrawlResult::STATUS_NO_CRITERIA, 'CV này chưa có "Từ khoá tìm kiếm".');
        }

        return $this->runSource($source, false, $criteria, $cv);
    }

    private function defaultCriteria(): JobCriteria
    {
        try {
            $cv = Cv::query()->orderByDesc('is_default')->orderByDesc('id')->first();
        } catch (QueryException) {
            return JobCriteria::parse(null);
        }

        return JobCriteria::parse($cv?->position);
    }

    private function runSource(string $key, bool $force, JobCriteria $criteria, ?Cv $cv): CrawlResult
    {
        $skipped = $this->skipReason($key, $force);

        if ($skipped !== null) {
            return new CrawlResult(CrawlResult::STATUS_SKIPPED, $skipped);
        }

        if ($criteria->isEmpty()) {
            $result = new CrawlResult(CrawlResult::STATUS_NO_CRITERIA, 'Chưa có CV có "Từ khoá tìm kiếm".');
            $this->remember($key, $result);

            return $result;
        }

        $crawler = app((string) config("jobs.sources.{$key}.crawler"));
        $result = $crawler->crawl($criteria);

        $this->store($key, $result->jobs);

        // * Only after a clean read: a blocked or failed source is not contacted again for detail pages.
        $matchNote = $result->status === CrawlResult::STATUS_OK ? $this->matcher->run($key, $cv) : null;
        $result = $matchNote === null ? $result : new CrawlResult($result->status, $result->message.' '.$matchNote, $result->jobs);
        $this->remember($key, $result);

        return $result;
    }

    private function skipReason(string $key, bool $force): ?string
    {
        $last = $this->states()[$key] ?? null;

        if (! $force && ($last['status'] ?? null) === CrawlResult::STATUS_BLOCKED
            && Date::parse((string) $last['at'])->gt(now()->subHours((int) config('jobs.blocked_cooldown_hours')))) {
            return 'Nguồn đã chặn gần đây; chờ hết thời gian nghỉ rồi mới thử lại.';
        }

        return null;
    }

    /** @param list<CrawledJob> $jobs */
    private function store(string $source, array $jobs): void
    {
        $now = now();
        $rows = array_map(fn (CrawledJob $job): array => [
            'source' => $source,
            'external_id' => $job->externalId,
            'url' => $job->url,
            'title' => $job->title,
            'company' => $job->company,
            'location' => $job->location,
            'salary_text' => $job->salaryText,
            'tags' => json_encode($job->tags, JSON_UNESCAPED_UNICODE),
            'posted_at' => $job->postedAt,
            'meta' => json_encode($job->meta),
            'first_seen_at' => $now,
            'last_seen_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ], $jobs);

        // * One statement per chunk. `first_seen_at`, `posted_at` and `created_at` are left out of the update list: they keep their first value.
        foreach (array_chunk($rows, self::UPSERT_CHUNK) as $chunk) {
            JobPosting::query()->upsert($chunk, ['source', 'url'], ['external_id', 'title', 'company', 'location', 'salary_text', 'tags', 'meta', 'last_seen_at', 'updated_at']);
        }
    }

    private function remember(string $key, CrawlResult $result): void
    {
        Setting::set(self::STATE_KEY, [...$this->states(), $key => [
            'status' => $result->status,
            'message' => $result->message,
            'count' => count($result->jobs),
            'at' => now()->toIso8601String(),
        ]]);
    }
}
