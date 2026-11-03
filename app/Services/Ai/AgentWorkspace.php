<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Support\Facades\File;

/** * The folder the CLI agents work in for one request: the local clone of a GitHub repo under `storage/app/repos`, or the folder of a local project, set only when an approved plan is run. Empty = the usual read-only folder. */
class AgentWorkspace
{
    private ?string $path = null;

    /** * Uses the repo's clone when it exists on disk; returns whether it did. */
    public function useRepo(string $repo): bool
    {
        $path = app(RepoCheckout::class)->path($repo);

        if ($path === null || ! File::isDirectory($path.'/.git')) {
            return false;
        }

        $this->path = $path;

        return true;
    }

    /** * Uses the folder of a local project (the person's own files, not a copy); returns whether it exists. */
    public function useLocal(string $rootId): bool
    {
        try {
            $path = app(LocalWorkspace::class)->path($rootId);
        } catch (LocalWorkspaceException) {
            return false;
        }

        if ($path === '' || ! File::isDirectory($path)) {
            return false;
        }

        $this->path = $path;

        return true;
    }

    public function path(): ?string
    {
        return $this->path;
    }
}
