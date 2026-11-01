<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Jobs\CrawlJobsJob;
use App\Models\Cv;
use App\Models\JobPosting;
use App\Models\Mailbox;
use App\Models\Setting;
use App\Services\Jobs\Alerts\AlertSources;
use App\Services\Jobs\Alerts\JobAlertIngestor;
use App\Services\Jobs\JobCrawlService;
use App\Support\ResourcePermission;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * * Job listings read from public TopCV/ITviec pages. Routes carry `jobs.{view,update}` middleware (see routes/web.php).
 * * Sources are only switched on or off; search keywords come from the CV's position. The application status is only a personal checklist: this app never opens, submits to or logs into a job site for you.
 */
class JobPostingController extends Controller
{
    private const PER_PAGE = 15;

    public function __construct(
        private readonly JobCrawlService $crawler,
        private readonly AlertSources $alertSources,
    ) {}

    public function index(Request $request): Response
    {
        $sources = $this->sources();
        $validated = $request->validate([
            'source' => ['nullable', 'in:'.implode(',', array_keys($sources))],
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:'.implode(',', array_keys(JobPosting::TRANSITIONS))],
        ]);
        $source = $validated['source'] ?? null;
        $search = trim((string) ($validated['q'] ?? ''));
        $status = $validated['status'] ?? null;

        $paginator = JobPosting::query()
            ->when($source !== null, fn ($query) => $query->where('source', $source))
            ->when($status !== null, fn ($query) => $query->where('application_status', $status))
            ->when($search !== '', function ($query) use ($search) {
                $like = '%'.addcslashes($search, '\\%_').'%';

                $query->where(fn ($inner) => $inner
                    ->where('title', 'like', $like)
                    ->orWhere('company', 'like', $like)
                    ->orWhere('location', 'like', $like)
                    ->orWhere('tags', 'like', $like));
            })
            ->orderByDesc('first_seen_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $totals = JobPosting::query()->selectRaw('source, count(*) as total')->groupBy('source')->pluck('total', 'source');
        $user = $request->user();

        return Inertia::render('jobs/index', [
            'jobs' => $paginator->through(fn (JobPosting $job): array => [
                'id' => $job->id,
                'source' => $job->source,
                'title' => $job->title,
                'company' => $job->company,
                'location' => $job->location,
                'salary_text' => $job->salary_text,
                'tags' => $job->tags ?? [],
                'url' => $job->url,
                'posted_at' => $job->posted_at?->toIso8601String(),
                'first_seen_at' => $job->first_seen_at->toIso8601String(),
                'via' => $job->meta['via'] ?? null,
                'application_status' => $job->application_status,
                'applied_at' => $job->applied_at?->toIso8601String(),
                'note' => $job->note,
                'match_score' => $job->meta['match_score'] ?? null,
            ])->toArray(),
            'filters' => ['source' => $source, 'q' => $search, 'status' => $status],
            'sources' => array_values($sources),
            'summary' => [
                'total' => (int) $totals->sum(),
                'new_24h' => JobPosting::query()->where('first_seen_at', '>=', now()->subDay())->count(),
                'by_source' => collect($sources)->map(fn (array $info, string $key): int => (int) ($totals[$key] ?? 0))->all(),
            ],
            'can' => ['update' => ResourcePermission::allows($user, 'jobs', 'update')],
        ]);
    }

    /** One job in full: the fit with the CV the AI gave, plus the pay, benefits and how to apply it read from the job page. */
    public function show(Request $request, JobPosting $jobPosting): Response
    {
        $meta = $jobPosting->meta ?? [];
        $cv = isset($meta['matched_cv_id']) ? Cv::query()->find($meta['matched_cv_id']) : null;

        return Inertia::render('jobs/show', [
            'job' => [
                'id' => $jobPosting->id,
                'source' => $jobPosting->source,
                'source_name' => (string) (config("jobs.sources.{$jobPosting->source}.name") ?? config("jobs.alerts.sources.{$jobPosting->source}.name") ?? $jobPosting->source),
                'title' => $jobPosting->title,
                'company' => $jobPosting->company,
                'location' => $jobPosting->location,
                'salary_text' => $jobPosting->salary_text,
                'tags' => $jobPosting->tags ?? [],
                'url' => $jobPosting->url,
                'posted_at' => $jobPosting->posted_at?->toIso8601String(),
                'first_seen_at' => $jobPosting->first_seen_at->toIso8601String(),
                'application_status' => $jobPosting->application_status,
                'applied_at' => $jobPosting->applied_at?->toIso8601String(),
                'note' => $jobPosting->note,
                'match' => isset($meta['match_score']) ? [
                    'score' => (int) $meta['match_score'],
                    'reason' => $meta['match_reason'] ?? null,
                    'benefits' => $meta['benefits'] ?? null,
                    'description' => $meta['description'] ?? null,
                    'requirements' => $meta['requirements'] ?? null,
                    'apply_email' => $meta['apply_email'] ?? null,
                    'apply_how' => $meta['apply_how'] ?? null,
                    'cv_name' => $cv?->name,
                    'matched_at' => $meta['matched_at'] ?? null,
                ] : null,
            ],
            'threshold' => (int) config('jobs.match.threshold'),
            'can' => ['update' => ResourcePermission::allows($request->user(), 'jobs', 'update')],
        ]);
    }

    /** "Nơi tìm việc": every source with its criteria and last read; criteria and credentials are edited under Tích hợp. */
    public function sourcesPage(Request $request): Response
    {
        return Inertia::render('jobs/sources', [
            'sources' => array_values($this->sources()),
            'can' => ['update' => ResourcePermission::allows($request->user(), 'jobs', 'update')],
        ]);
    }

    /** Manual "Tìm việc ngay": runs in the background like the scheduler's run (a source in its block cooldown stays untouched); the outcome shows on "Nơi tìm việc". */
    public function crawl(Request $request): RedirectResponse
    {
        $validated = $request->validate(['source' => ['nullable', 'in:'.implode(',', $this->crawler->sources())]]);

        CrawlJobsJob::dispatchAfterResponse($validated['source'] ?? null);

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đang tìm việc ở nền, vài phút nữa xem kết quả ở "Nơi tìm việc" và trang Việc làm.']);

        return back();
    }

    /** The switch on "Nơi tìm việc": only sources with a crawler can be switched. */
    public function toggleSource(Request $request, string $source): RedirectResponse
    {
        abort_unless(in_array($source, $this->crawler->sources(), true), 404);

        $this->crawler->setEnabled($source, $request->validate(['enabled' => ['required', 'boolean']])['enabled']);

        return back();
    }

    /** "Tìm việc" on the CV page: runs in the background; searches by that CV's keywords and scores the new jobs against that CV. */
    public function findForCv(Cv $cv): RedirectResponse
    {
        CrawlJobsJob::dispatchAfterResponse(null, $cv->id);

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đang tìm việc ở nền, vài phút nữa xem kết quả ở trang Việc làm.']);

        return back();
    }

    /**
     * Manual review step. "Approved" and "applied" only record what the user did on the job site themselves;
     * nothing is sent to the site.
     */
    public function updateStatus(Request $request, JobPosting $jobPosting): RedirectResponse
    {
        $validated = $request->validate([
            'status' => ['required', 'string', 'in:'.implode(',', array_keys(JobPosting::TRANSITIONS))],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);
        $from = $jobPosting->application_status;
        $to = $validated['status'];

        if ($to !== $from && ! in_array($to, JobPosting::TRANSITIONS[$from] ?? [], true)) {
            throw ValidationException::withMessages(['status' => 'Không thể chuyển trạng thái này.']);
        }

        $jobPosting->application_status = $to;

        if (array_key_exists('note', $validated)) {
            $note = trim((string) $validated['note']);
            $jobPosting->note = $note !== '' ? $note : null;
        }

        if ($to === JobPosting::STATUS_APPLIED && $from !== JobPosting::STATUS_APPLIED) {
            $jobPosting->applied_at = now();
        }

        $jobPosting->save();

        return back();
    }

    private function sources(): array
    {
        $alerts = $this->alertSources->all();
        $states = $this->crawler->states();
        $enabled = $this->crawler->enabled();
        $lastRun = Setting::get(JobAlertIngestor::SETTING_KEY);
        $hasMailbox = Mailbox::query()->where('status', Mailbox::STATUS_CONNECTED)->exists();
        $sources = [];

        foreach (array_unique([...$this->crawler->sources(), ...array_keys($alerts)]) as $key) {
            $crawls = in_array($key, $this->crawler->sources(), true);
            $definition = $crawls ? (array) config("jobs.sources.{$key}") : null;
            $profile = $alerts[$key] ?? null;
            $last = $crawls ? ($states[$key] ?? []) : [];
            $emailActive = $profile !== null && $hasMailbox;
            $sources[$key] = [
                'key' => $key,
                'name' => $definition['name'] ?? $profile['name'],
                'letter' => $definition['letter'] ?? $profile['letter'],
                'color' => $definition['color'] ?? $profile['color'],
                'active' => ($crawls && in_array($key, $enabled, true)) || $emailActive,
                'crawl' => $crawls,
                'enabled' => in_array($key, $enabled, true),
                'email' => $profile !== null,
                'last_status' => $last['status'] ?? null,
                'last_message' => $last['message'] ?? null,
                'last_at' => $last['at'] ?? null,
                'email_last_status' => $profile !== null && $lastRun !== null ? $lastRun['status'] : null,
                'email_last_count' => $profile !== null && $lastRun !== null ? (int) ($lastRun['by_source'][$key] ?? 0) : null,
                'email_last_at' => $profile !== null ? ($lastRun['at'] ?? null) : null,
            ];
        }

        return $sources;
    }
}
