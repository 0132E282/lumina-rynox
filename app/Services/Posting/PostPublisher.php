<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\PostTarget;

interface PostPublisher
{
    /**
     * * One attempt, never a retry. Returns the outcome instead of throwing: `published`, `failed` (the platform refused or
     * * nothing was sent) or `unknown` (timeout/5xx while sending, so the post may exist).
     */
    public function publish(PostTarget $target): PublishResult;
}
