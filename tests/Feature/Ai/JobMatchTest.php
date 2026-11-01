<?php

declare(strict_types=1);

namespace Tests\Feature\Ai;

use App\Jobs\CrawlJobsJob;
use App\Models\Cv;
use App\Models\Integration;
use App\Models\JobPosting;
use App\Services\Jobs\JobMatchService;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;

class JobMatchTest extends AiTestCase
{
    private function job(string $slug): JobPosting
    {
        return JobPosting::query()->create([
            'source' => 'itviec', 'external_id' => $slug, 'url' => 'https://itviec.com/it-jobs/'.$slug, 'title' => 'Backend '.$slug,
            'first_seen_at' => now(), 'last_seen_at' => now(),
        ]);
    }

    private function fakeWeb(array $answers): void
    {
        $sequence = Http::sequence();

        foreach ($answers as $answer) {
            $sequence->push(['content' => [['type' => 'text', 'text' => json_encode($answer, JSON_UNESCAPED_UNICODE)]]]);
        }

        Http::fake([
            'itviec.com/robots.txt' => Http::response("User-agent: *\nAllow: /", 200),
            'itviec.com/it-jobs/*' => Http::response('<html><body><h1>Backend PHP</h1><p>Gửi CV về hr@acme.vn. Phúc lợi: bảo hiểm.</p><script>x()</script></body></html>'),
            'api.anthropic.com/*' => $sequence,
        ]);
    }

    public function test_jobs_at_or_above_the_threshold_stay_and_the_rest_are_skipped_with_the_details_kept(): void
    {
        Cv::query()->create(['name' => 'CV', 'position' => 'Backend', 'content' => 'PHP Laravel 6 năm', 'is_default' => true]);
        $this->account();
        $good = $this->job('good');
        $bad = $this->job('bad');
        $this->fakeWeb([
            ['score' => 85, 'reason' => 'Khớp PHP', 'salary' => '40 triệu', 'benefits' => 'bảo hiểm', 'apply_email' => 'hr@acme.vn', 'apply_how' => 'Gửi CV qua email'],
            ['score' => 40, 'reason' => 'Khác ngành', 'salary' => null, 'benefits' => null, 'apply_email' => 'bịa@nowhere.vn', 'apply_how' => null],
        ]);

        $note = app(JobMatchService::class)->run('itviec');

        $this->assertNull($note);
        // * The newest job is scored first.
        $bad->refresh();
        $good->refresh();
        $this->assertSame(JobPosting::STATUS_NEW, $bad->application_status === JobPosting::STATUS_SKIPPED ? $good->application_status : $bad->application_status);
        $high = $good->meta['match_score'] === 85 ? $good : $bad;
        $low = $high->is($good) ? $bad : $good;
        $this->assertSame(JobPosting::STATUS_NEW, $high->application_status);
        $this->assertSame('hr@acme.vn', $high->meta['apply_email']);
        $this->assertSame('40 triệu', $high->salary_text);
        $this->assertSame(JobPosting::STATUS_SKIPPED, $low->application_status);
        // * An e-mail that is not in the job text is dropped, never kept as a guess.
        $this->assertNull($low->meta['apply_email']);
    }

    public function test_nothing_is_scored_without_a_cv_and_no_job_page_is_opened(): void
    {
        $this->account();
        $this->job('x');
        Http::fake();

        $this->assertStringContainsString('CV', (string) app(JobMatchService::class)->run('itviec'));
        Http::assertNothingSent();
    }

    public function test_a_failing_ai_stops_the_run_and_leaves_the_jobs_unscored(): void
    {
        Cv::query()->create(['name' => 'CV', 'content' => 'PHP', 'is_default' => true]);
        $this->account();
        $job = $this->job('y');
        Http::fake([
            'itviec.com/robots.txt' => Http::response('', 404),
            'itviec.com/it-jobs/*' => Http::response('<html><body>Job</body></html>'),
            'api.anthropic.com/*' => Http::response(['error' => 'x'], 500),
        ]);

        $this->assertNotNull(app(JobMatchService::class)->run('itviec'));
        $this->assertArrayNotHasKey('match_score', $job->refresh()->meta ?? []);
    }

    public function test_find_jobs_on_a_cv_searches_by_its_position_and_scores_against_that_cv(): void
    {
        $default = Cv::query()->create(['name' => 'CV mặc định', 'position' => 'Frontend', 'content' => 'React', 'is_default' => true]);
        $cv = Cv::query()->create(['name' => 'CV backend', 'position' => 'Backend PHP', 'content' => 'Laravel 6 năm']);
        $this->account();
        Integration::query()->create(['provider' => 'itviec', 'status' => 'connected', 'settings' => []]);
        $searched = [];
        Http::fake([
            'itviec.com/robots.txt' => Http::response('', 404),
            'itviec.com/it-jobs?*' => function ($request) use (&$searched) {
                $searched[] = $request->url();

                return Http::response('<html><body><div class="job-card" data-search--job-selection-job-slug-value="be-1"><h3><a href="/it-jobs/be-1">Backend 1</a></h3></div></body></html>');
            },
            'itviec.com/it-jobs/*' => Http::response('<html><body>Backend PHP, gửi CV hr@acme.vn</body></html>'),
            'api.anthropic.com/*' => Http::response(['content' => [['type' => 'text', 'text' => '{"score":90,"reason":"ok","salary":null,"benefits":null,"apply_email":"hr@acme.vn","apply_how":null}']]]),
        ]);

        $this->actingAs($this->admin())->post(route('cvs.find-jobs', $cv))->assertRedirect();

        $this->assertStringContainsString('Backend', $searched[0] ?? '');
        $this->assertStringNotContainsString('Frontend', $searched[0] ?? '');
        $job = JobPosting::query()->where('source', 'itviec')->firstOrFail();
        $this->assertSame(90, $job->meta['match_score']);
        $this->assertSame($cv->id, $job->meta['matched_cv_id']);
        $this->assertNotSame($default->id, $job->meta['matched_cv_id']);
    }

    public function test_find_jobs_needs_a_position_and_jobs_update(): void
    {
        $cv = Cv::query()->create(['name' => 'CV trống', 'content' => 'x']);
        Http::fake();

        $this->actingAs($this->admin(false))->post(route('cvs.find-jobs', $cv))->assertForbidden();
        Bus::fake();
        $this->actingAs($this->admin())->post(route('cvs.find-jobs', $cv))->assertRedirect();
        Bus::assertDispatchedAfterResponse(CrawlJobsJob::class, fn (CrawlJobsJob $job): bool => $job->cvId === $cv->id);
        Http::assertNothingSent();
    }

    public function test_the_expected_salary_of_the_cv_reaches_the_ai(): void
    {
        Cv::query()->create(['name' => 'CV', 'position' => 'PHP', 'expected_salary' => '35-45 triệu', 'content' => 'Laravel 6 năm']);
        $this->account();
        $this->job('pay');
        $this->fakeWeb([['score' => 80, 'reason' => 'ok', 'salary' => null, 'benefits' => null, 'apply_email' => null, 'apply_how' => null]]);

        app(JobMatchService::class)->run('itviec');

        Http::assertSent(fn ($request): bool => str_contains((string) $request->url(), 'anthropic') && str_contains(json_encode($request->data(), JSON_UNESCAPED_UNICODE), '35-45 triệu'));
    }

    public function test_the_job_page_shows_the_score_pay_benefits_and_how_to_apply(): void
    {
        $cv = Cv::query()->create(['name' => 'CV backend', 'position' => 'PHP']);
        $job = $this->job('detail');
        $job->update(['salary_text' => '40 triệu', 'meta' => ['match_score' => 82, 'match_reason' => 'Khớp PHP', 'benefits' => 'Bảo hiểm, thưởng tháng 13', 'apply_email' => 'hr@acme.vn', 'apply_how' => 'Gửi CV qua email', 'matched_cv_id' => $cv->id]]);

        $this->actingAs($this->admin())->get(route('jobs.show', $job))->assertOk()->assertInertia(fn ($page) => $page
            ->component('jobs/show')
            ->where('job.match.score', 82)
            ->where('job.match.benefits', 'Bảo hiểm, thưởng tháng 13')
            ->where('job.match.apply_email', 'hr@acme.vn')
            ->where('job.match.cv_name', 'CV backend')
            ->where('job.salary_text', '40 triệu'));
    }

    public function test_an_unscored_job_page_still_opens_and_needs_jobs_view(): void
    {
        $job = $this->job('plain');

        $this->actingAs($this->admin(false))->get(route('jobs.show', $job))->assertForbidden();
        $this->actingAs($this->admin())->get(route('jobs.show', $job))->assertOk()->assertInertia(fn ($page) => $page->where('job.match', null));
    }
}
