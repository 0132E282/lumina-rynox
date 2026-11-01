<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Models\Post;
use App\Models\PostTarget;
use App\Services\Posting\PostPublishingService;
use Illuminate\Foundation\Bus\Dispatchable;

/**
 * * Used with `dispatchAfterResponse()` from the post screens, so no queue worker is needed. One try, never retried:
 * * with `$targetId` it publishes a target the controller already claimed; otherwise it claims and publishes the whole post.
 */
final class PublishPostJob
{
    use Dispatchable;

    public function __construct(private readonly int $postId, private readonly ?int $targetId = null) {}

    public function handle(PostPublishingService $service): void
    {
        if ($this->targetId !== null) {
            $target = PostTarget::query()->where('post_id', $this->postId)->find($this->targetId);

            if ($target !== null && $target->status === PostTarget::STATUS_PUBLISHING) {
                $service->publishClaimedTarget($target);
            }

            return;
        }

        $post = Post::query()->find($this->postId);

        if ($post !== null) {
            $service->publishPost($post);
        }
    }
}
