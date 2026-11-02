<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;

/** * Keeps a local clone of each GitHub repo the person added to the Code tab, under `storage/app/repos/<owner>/<name>` (git-ignored with the rest of `storage/app`). Never overwrites an existing checkout. */
class RepoCheckout
{
    public function __construct(private readonly GithubReader $github) {}

    public function path(string $repo): ?string
    {
        [$owner, $name] = array_pad(explode('/', $repo, 2), 2, '');

        // * `owner/name` only: no empty parts and never `.` or `..`, so the folder cannot leave the checkout base.
        foreach ([$owner, $name] as $part) {
            if ($part === '' || $part === '.' || $part === '..' || preg_match('/^[A-Za-z0-9_.-]+$/', $part) !== 1) {
                return null;
            }
        }

        return storage_path("app/repos/{$owner}/{$name}");
    }

    /** * Lists the repo in `.gitmodules` (`path` = its checkout, relative to the project; `url` = its GitHub page). Only the entry is written, never a gitlink, so no repo content is ever pushed. */
    public function register(string $repo): void
    {
        $path = $this->path($repo);
        $file = (string) config('ai-chat.gitmodules_path');

        if ($path === null || app()->environment('production') || $file === '') {
            return;
        }

        $current = File::exists($file) ? File::get($file) : '';

        if (str_contains($current, "[submodule \"{$repo}\"]")) {
            return;
        }

        $relative = ltrim(str_replace(base_path(), '', $path), '/');

        File::put($file, $current.($current !== '' && ! str_ends_with($current, "\n") ? "\n" : '')."[submodule \"{$repo}\"]\n\tpath = {$relative}\n\turl = https://github.com/{$repo}\n", LOCK_EX);
    }

    /** * Takes the repo's entry out of `.gitmodules` (the clone on disk stays). */
    public function unregister(string $repo): void
    {
        $file = (string) config('ai-chat.gitmodules_path');

        if ($this->path($repo) === null || $file === '' || ! File::exists($file)) {
            return;
        }

        $next = preg_replace('/\[submodule "'.preg_quote($repo, '/').'"\]\n(?:[ \t]+[^\n]*\n?)*/', '', File::get($file));

        if ($next !== null) {
            File::put($file, $next, LOCK_EX);
        }
    }

    /** * Clones the repo when it is not on disk yet; returns whether a checkout exists afterwards. The token travels in the environment of the git process, never in its arguments or the clone's config. */
    public function clone(string $repo): bool
    {
        $path = $this->path($repo);

        if ($path === null || app()->environment('production')) {
            return false;
        }

        if (File::isDirectory($path.'/.git')) {
            return true;
        }

        $token = $this->github->token();
        $env = [];

        if ($token !== null) {
            $env = [
                'GIT_CONFIG_COUNT' => '1',
                'GIT_CONFIG_KEY_0' => 'http.extraHeader',
                'GIT_CONFIG_VALUE_0' => 'Authorization: Basic '.base64_encode('x-access-token:'.$token),
                'GIT_TERMINAL_PROMPT' => '0',
            ];
        }

        File::ensureDirectoryExists(dirname($path));

        return Process::env($env)->timeout(600)->run(['git', 'clone', '--quiet', "https://github.com/{$repo}.git", $path])->successful();
    }
}
