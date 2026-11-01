<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Post;
use App\Services\Posting\PostPublishingService;
use Illuminate\Console\Command;

class PublishDuePostsCommand extends Command
{
    protected $signature = 'posts:publish-due';

    protected $description = 'Publish scheduled posts that are due (each target once); posts later than the grace period become "missed" instead';

    public function handle(PostPublishingService $service): int
    {
        $recovered = $service->recoverStale();

        // * D8: a post that is much too late is never sent on its own; the owner decides (publish now / reschedule / dismiss).
        $missed = Post::query()
            ->where('status', Post::STATUS_SCHEDULED)
            ->where('scheduled_at', '<', now()->subMinutes((int) config('posting.late_after_minutes')))
            ->update(['status' => Post::STATUS_MISSED, 'updated_at' => now()]);

        $published = 0;

        Post::query()
            ->where('status', Post::STATUS_SCHEDULED)
            ->where('scheduled_at', '<=', now())
            // * `chunkById` pages by id, so rows leaving `scheduled` while the loop runs are not skipped.
            ->chunkById(50, function ($posts) use ($service, &$published): void {
                foreach ($posts as $post) {
                    // * Claimed by one atomic UPDATE: a concurrent run or the "publish now" job that took it first makes this a no-op.
                    if ($service->publishPost($post, [Post::STATUS_SCHEDULED])) {
                        $published++;
                    }
                }
            });

        $this->info("Published {$published} post(s), {$missed} marked missed, {$recovered} recovered.");

        return self::SUCCESS;
    }
}
