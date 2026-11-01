<?php

declare(strict_types=1);

namespace Tests\Feature\Ai;

use App\Models\Cv;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;

class JobCrawlThrottleTest extends AiTestCase
{
    public function test_other_throttled_routes_do_not_eat_the_crawl_allowance(): void
    {
        Http::fake();
        Process::fake();
        $admin = $this->admin();
        $cv = Cv::query()->create(['name' => 'CV']);

        // * Hammering a different unnamed-throttle route (status polling) must not lock the crawl button.
        for ($i = 0; $i < 12; $i++) {
            $this->actingAs($admin)->getJson(route('integrations.ai.cli.status', ['vendor' => 'anthropic']));
        }

        $this->post(route('cvs.find-jobs', $cv))->assertRedirect();
        $this->post(route('jobs.crawl'))->assertRedirect();
    }
}
