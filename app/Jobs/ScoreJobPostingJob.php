<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\Jobs\JobMatchService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * * The AI scoring of ONE job posting against a CV. Normally run in place with `dispatchSync` (no queue worker needed); with
 * * `jobs.match.queued` it is queued instead and needs `php artisan queue:work`. Never retried: a repeat would read the site and spend AI quota twice.
 * * Returns why the run should stop (site blocked, AI failing) so the caller can stop starting more.
 */
final class ScoreJobPostingJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;

    public int $tries = 1;

    public int $timeout = 180;

    public function __construct(public readonly int $postingId, public readonly ?int $cvId = null) {}

    public function handle(JobMatchService $matcher): ?string
    {
        return $matcher->scorePosting($this->postingId, $this->cvId);
    }
}
