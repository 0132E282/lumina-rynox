<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\Ai\RepoCheckout;
use Illuminate\Foundation\Bus\Dispatchable;

/** * Clones a repo the person just added to the Code tab; run after the response is sent, so adding it never waits for git. */
class CloneRepoJob
{
    use Dispatchable;

    public function __construct(private readonly string $repo) {}

    public function handle(RepoCheckout $checkout): void
    {
        $checkout->clone($this->repo);
    }
}
