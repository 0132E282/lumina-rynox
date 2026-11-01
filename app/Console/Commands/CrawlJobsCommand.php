<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\Jobs\JobCrawlService;
use Illuminate\Console\Command;

class CrawlJobsCommand extends Command
{
    protected $signature = 'jobs:crawl
        {source? : topcv or itviec; all sources when omitted}
        {--force : Ignore the cooldown after a block (still honours robots.txt and stops on a new block)}';

    protected $description = 'Read public job listings (no login, robots.txt honoured) for the sources switched on at "Nơi tìm việc", with keywords from the CV's position, then score new jobs against the CV';

    public function handle(JobCrawlService $service): int
    {
        $source = $this->argument('source');

        if ($source !== null && ! in_array($source, $service->sources(), true)) {
            $this->error('Unknown source. Use: '.implode(', ', $service->sources()).'.');

            return self::INVALID;
        }

        foreach ($service->run($source, (bool) $this->option('force')) as $key => $result) {
            $this->line("{$key}: {$result->status} - {$result->message}");
        }

        return self::SUCCESS;
    }
}
