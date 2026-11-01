<?php

declare(strict_types=1);

namespace App\Services\Jobs;

use App\Jobs\ScoreJobPostingJob;
use App\Models\Cv;
use App\Models\JobPosting;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * Scores new jobs of the public sources against the default CV with the AI. The job's own page is read politely (same rules as a
 * crawl), the AI returns the fit plus salary, benefits, apply e-mail and how to apply, and all of it is kept in `meta`. A job below
 * the threshold is set aside as skipped; nothing is sent to anyone and no one is applied to.
 */
class JobMatchService
{
    public function __construct(private readonly AiAssistant $ai) {}

    /** @var array<string, AbstractJobCrawler> one crawler per source for the whole run, so robots.txt is read once and the pause between pages holds */
    private array $crawlers = [];

    /**
     * Starts one scoring job per new posting of the source. `$cv` null = the default CV. By default each posting is scored right here (the same
     * work `ScoreJobPostingJob` does), one after the other with no queue worker and the first stop (blocked site, AI down) ends the run; with `jobs.match.queued` each is
     * queued instead, staggered by the crawl pause, and needs `php artisan queue:work`.
     *
     * @return string|null why it stopped early (shown with the crawl outcome), null when nothing needs saying
     */
    public function run(string $source, ?Cv $cv = null): ?string
    {
        $config = (array) config('jobs.match');

        if (! in_array($source, (array) ($config['sources'] ?? []), true)) {
            return null;
        }

        if ($this->cvText((int) $config['cv_chars'], $cv) === null) {
            return 'Chưa có CV có nội dung nên chưa chấm độ phù hợp.';
        }

        $pending = JobPosting::query()
            ->where('source', $source)
            ->where('application_status', JobPosting::STATUS_NEW)
            ->whereNull('meta->match_score')
            ->orderByDesc('id')
            ->limit((int) $config['max_per_run'])
            ->pluck('id');

        foreach ($pending->values() as $position => $id) {
            if ((bool) ($config['queued'] ?? false)) {
                ScoreJobPostingJob::dispatch($id, $cv?->id)->delay(now()->addMilliseconds($position * (int) config('jobs.delay_milliseconds')));

                continue;
            }

            $stopped = $this->scorePosting($id, $cv?->id);

            if (is_string($stopped)) {
                return $stopped;
            }
        }

        return null;
    }

    /**
     * Scores ONE posting: reads its page, asks the AI and keeps the answer in `meta`. A posting below the threshold is set aside as skipped.
     *
     * @return string|null why the run should stop (site blocked, AI failing), null otherwise
     */
    public function scorePosting(int $postingId, ?int $cvId): ?string
    {
        $config = (array) config('jobs.match');
        $job = JobPosting::query()->find($postingId);

        if ($job === null || $job->application_status !== JobPosting::STATUS_NEW || isset($job->meta['match_score'])) {
            return null;
        }

        $cv = $cvId === null ? null : Cv::query()->find($cvId);
        $cvText = $this->cvText((int) $config['cv_chars'], $cv);
        $crawler = $this->crawlers[$job->source] ??= app((string) config("jobs.sources.{$job->source}.crawler"));

        if ($cvText === null || ! $crawler instanceof AbstractJobCrawler) {
            return null;
        }

        try {
            $text = $crawler->pageText($job->url, (int) $config['job_chars']);
            $match = $text === null ? null : $this->ai->matchJob($cvText, $text);
        } catch (CrawlStoppedException $stopped) {
            return $stopped->getMessage();
        } catch (AiException $exception) {
            return $exception->getMessage();
        }

        if ($match === null) {
            return null;
        }

        $job->meta = [...($job->meta ?? []), 'match_score' => $match['score'], 'match_reason' => $match['reason'], 'benefits' => $match['benefits'], 'content' => $text, 'content' => $text, 'description' => $match['description'], 'requirements' => $match['requirements'],
            'apply_email' => $match['apply_email'], 'apply_how' => $match['apply_how'], 'matched_cv_id' => $cv?->id, 'matched_at' => now()->toIso8601String()];
        $job->salary_text ??= $match['salary'];

        if ($match['score'] < (int) $config['threshold']) {
            $job->application_status = JobPosting::STATUS_SKIPPED;
        }

        $job->save();

        return null;
    }

    private function cvText(int $maxChars, ?Cv $cv): ?string
    {
        try {
            $cv ??= Cv::query()->orderByDesc('is_default')->orderByDesc('id')->first();
        } catch (QueryException) {
            return null;
        }

        $content = trim((string) $cv?->content);

        return $content === '' ? null : Str::limit(trim((blank($cv->desired_position) ? '' : 'Vị trí ứng tuyển: '.$cv->desired_position."\n").($cv->position === null ? '' : 'Từ khoá tìm kiếm: '.$cv->position."\n").(blank($cv->expected_salary) ? '' : 'Mức lương mong muốn: '.$cv->expected_salary."\n").$content), $maxChars, '');
    }
}
