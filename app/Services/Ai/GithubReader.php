<?php

declare(strict_types=1);

namespace App\Services\Ai;

use App\Models\Integration;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Read-only view of one GitHub repo for the AI chat: file tree, README, the repo's rules and skill files, files the person names, and webhook summaries.
 * ! Only GET requests. The token stays on the server; webhook URLs lose their query string and credentials before they reach the prompt.
 */
class GithubReader
{
    public const PROVIDER = 'github';

    private const API = 'https://api.github.com';

    private const MAX_TREE_PATHS = 300;

    private const MAX_BROWSE_PATHS = 5000;

    private const MAX_NAMED_FILES = 4;

    private const MAX_RULE_FILES = 6;

    private const MAX_FILE_BYTES = 200000;

    private const FILE_CHARS = 8000;

    private const README_CHARS = 6000;

    private const MAX_CONTEXT = 45000;

    private const REPOS_TTL_SECONDS = 60;

    private const TEXT_EXTENSIONS = ['php', 'js', 'jsx', 'ts', 'tsx', 'vue', 'json', 'md', 'mdx', 'txt', 'yml', 'yaml', 'toml', 'ini', 'env', 'css', 'scss', 'html', 'blade', 'sql', 'sh', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'xml', 'lock'];

    /** Root instruction files and rule/skill folders an AI agent is told to follow. */
    private const RULE_PATTERNS = [
        '#^(AGENTS|AGENT|CLAUDE|GEMINI)\.md$#i',
        '#^\.github/copilot-instructions\.md$#',
        '#^\.(agents|claude|codex|cursor)/rules/[^/]+\.(md|mdc|txt)$#',
    ];

    private const SKILL_PATTERN = '#^\.(agents|claude|codex)/skills/([^/]+)/SKILL\.md$#';

    public function token(): ?string
    {
        $token = Integration::query()->where('provider', self::PROVIDER)->first()?->credentials['token'] ?? null;

        return is_string($token) && $token !== '' ? $token : null;
    }

    public function connected(): bool
    {
        return $this->token() !== null;
    }

    /**
     * @return list<array{full_name: string, private: bool, default_branch: string, description: string|null}>
     *
     * @throws GithubException
     */
    public function repos(): array
    {
        return Cache::remember('github.repos', self::REPOS_TTL_SECONDS, function (): array {
            $rows = $this->get('/user/repos', ['per_page' => 100, 'sort' => 'pushed', 'affiliation' => 'owner,collaborator,organization_member'])->json();

            return collect(is_array($rows) ? $rows : [])->map(fn (array $row): array => [
                'full_name' => (string) ($row['full_name'] ?? ''),
                'private' => (bool) ($row['private'] ?? false),
                'default_branch' => (string) ($row['default_branch'] ?? 'main'),
                'description' => isset($row['description']) ? Str::limit((string) $row['description'], 120) : null,
            ])->filter(fn (array $row): bool => $row['full_name'] !== '')->values()->all();
        });
    }

    /**
     * Text for the `<repo_data>` block. `$message` is only searched for file paths the person wrote.
     *
     * @throws GithubException
     */
    public function context(string $repo, string $message): string
    {
        if (preg_match('#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#', $repo) !== 1) {
            throw new GithubException(GithubException::BAD_REPO);
        }

        $branch = $this->defaultBranch($repo);
        $tree = $this->tree($repo, $branch);
        $paths = array_keys($tree);

        $activity = app(ChatActivity::class);
        $activity->record('tree', "GitHub {$repo}", count($paths).' tệp, nhánh '.$branch);
        $sections = ["Repo: {$repo} (nhánh {$branch})", $this->treeSection($paths)];
        $sections[] = $this->readme($repo);
        $activity->record('file', "GitHub {$repo}", 'README');

        $rules = $this->rulePaths($paths);
        $skills = $this->skillPaths($paths);

        if ($skills !== []) {
            $sections[] = "Skill của repo (đường dẫn):\n".implode("\n", array_map(fn (string $path): string => "- {$path}", $skills));
        }

        // * Rules first, then files the person named (skills are read only when named): the cap cuts the least important last.
        $named = $this->namedPaths($tree, $message);

        foreach (array_slice($rules, 0, self::MAX_RULE_FILES) as $path) {
            $sections[] = $this->fileSection($repo, $branch, $path, 'Rule/chỉ dẫn');
            $activity->record('file', "GitHub {$repo}", $path);
        }

        foreach ($named as $path) {
            $sections[] = $this->fileSection($repo, $branch, $path, 'File');
            $activity->record('file', "GitHub {$repo}", $path);
        }

        $sections[] = $this->hooksSection($repo);

        return Str::limit(implode("\n\n", array_filter($sections)), self::MAX_CONTEXT, "\n… (đã cắt bớt)");
    }

    /** @throws GithubException */
    public function defaultBranch(string $repo): string
    {
        return (string) ($this->get("/repos/{$repo}")->json('default_branch') ?? 'main');
    }

    /**
     * The file as it is on `$branch`, for diffing an AI edit against it.
     *
     * @return array{sha: string, content: string}|null null when the file does not exist (or is not a small UTF-8 text file)
     *
     * @throws GithubException
     */
    public function currentFile(string $repo, string $branch, string $path): ?array
    {
        $encoded = implode('/', array_map('rawurlencode', explode('/', $path)));

        try {
            $json = $this->get("/repos/{$repo}/contents/{$encoded}", ['ref' => $branch])->json();
        } catch (GithubException $exception) {
            if ($exception->getCode() === 404) {
                return null;
            }

            throw $exception;
        }

        if (! is_array($json) || ($json['type'] ?? null) !== 'file' || ! is_string($json['sha'] ?? null) || (int) ($json['size'] ?? 0) > self::MAX_FILE_BYTES) {
            return null;
        }

        $content = base64_decode(str_replace("\n", '', (string) ($json['content'] ?? '')), true);

        return $content === false || ! mb_check_encoding($content, 'UTF-8') ? null : ['sha' => $json['sha'], 'content' => $content];
    }

    /**
     * File paths of the repo's default branch, for the read-only code viewer.
     *
     * @return array{branch: string, paths: list<string>}
     *
     * @throws GithubException
     */
    public function browse(string $repo): array
    {
        return Cache::remember("github.browse.{$repo}", self::REPOS_TTL_SECONDS, function () use ($repo): array {
            $branch = $this->defaultBranch($repo);

            return ['branch' => $branch, 'paths' => array_slice(array_keys($this->tree($repo, $branch)), 0, self::MAX_BROWSE_PATHS)];
        });
    }

    /**
     * One small UTF-8 text file of the default branch (null when missing, large or binary).
     *
     * @throws GithubException
     */
    public function readFile(string $repo, string $path): ?string
    {
        return $this->currentFile($repo, $this->defaultBranch($repo), $path)['content'] ?? null;
    }

    /**
     * An image of the default branch as raw bytes for the viewer (null when missing, too large or not a file).
     *
     * @throws GithubException
     */
    public function readImage(string $repo, string $path): ?string
    {
        $encoded = implode('/', array_map('rawurlencode', explode('/', $path)));

        try {
            $json = $this->get("/repos/{$repo}/contents/{$encoded}", ['ref' => $this->defaultBranch($repo)])->json();
        } catch (GithubException $exception) {
            if ($exception->getCode() === 404) {
                return null;
            }

            throw $exception;
        }

        if (! is_array($json) || ($json['type'] ?? null) !== 'file' || (int) ($json['size'] ?? 0) > ImageFiles::MAX_BYTES) {
            return null;
        }

        $bytes = base64_decode(str_replace("\n", '', (string) ($json['content'] ?? '')), true);

        return $bytes === false || $bytes === '' ? null : $bytes;
    }

    /** @return array<string, int> path => size of the text-like files of the tree */
    private function tree(string $repo, string $branch): array
    {
        $rows = $this->get("/repos/{$repo}/git/trees/".rawurlencode($branch), ['recursive' => 1])->json('tree');
        $files = [];

        foreach (is_array($rows) ? $rows : [] as $row) {
            if (($row['type'] ?? null) === 'blob' && is_string($row['path'] ?? null)) {
                $files[$row['path']] = (int) ($row['size'] ?? 0);
            }
        }

        return $files;
    }

    /** @param list<string> $paths */
    private function treeSection(array $paths): string
    {
        $shown = array_slice($paths, 0, self::MAX_TREE_PATHS);
        $more = count($paths) - count($shown);

        return 'Cây file ('.count($shown).'/'.count($paths)."):\n".implode("\n", $shown).($more > 0 ? "\n… và {$more} file nữa" : '');
    }

    private function readme(string $repo): string
    {
        try {
            $text = $this->get("/repos/{$repo}/readme", [], 'application/vnd.github.raw+json')->body();
        } catch (GithubException) {
            return '';
        }

        return "README:\n".Str::limit($text, self::README_CHARS, '…');
    }

    /**
     * @param  list<string>  $paths
     * @return list<string>
     */
    private function rulePaths(array $paths): array
    {
        return array_values(array_filter($paths, function (string $path): bool {
            foreach (self::RULE_PATTERNS as $pattern) {
                if (preg_match($pattern, $path) === 1) {
                    return true;
                }
            }

            return false;
        }));
    }

    /**
     * @param  list<string>  $paths
     * @return list<string>
     */
    private function skillPaths(array $paths): array
    {
        return array_values(array_filter($paths, fn (string $path): bool => preg_match(self::SKILL_PATTERN, $path) === 1));
    }

    /**
     * Files whose full path (or a distinctive file name) the person wrote in the message; skill files count too.
     *
     * @param  array<string, int>  $tree
     * @return list<string>
     */
    private function namedPaths(array $tree, string $message): array
    {
        $full = [];
        $byName = [];

        foreach ($tree as $path => $size) {
            $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));

            if ($size > self::MAX_FILE_BYTES || ! in_array($extension, self::TEXT_EXTENSIONS, true)) {
                continue;
            }

            if (str_contains($message, $path)) {
                $full[] = $path;
            } elseif (mb_strlen(basename($path)) >= 6 && str_contains($message, basename($path))) {
                $byName[] = $path;
            }
        }

        return array_slice(array_values(array_unique([...$full, ...$byName])), 0, self::MAX_NAMED_FILES);
    }

    private function fileSection(string $repo, string $branch, string $path, string $label): string
    {
        $encoded = implode('/', array_map('rawurlencode', explode('/', $path)));

        try {
            $text = $this->get("/repos/{$repo}/contents/{$encoded}", ['ref' => $branch], 'application/vnd.github.raw+json')->body();
        } catch (GithubException) {
            return '';
        }

        if (! mb_check_encoding($text, 'UTF-8')) {
            return '';
        }

        return "{$label}: {$path}\n".Str::limit($text, self::FILE_CHARS, "\n… (đã cắt bớt)");
    }

    // * Webhooks need admin rights on the repo: without them GitHub answers 403/404 and the section is simply left out.
    private function hooksSection(string $repo): string
    {
        try {
            $hooks = $this->get("/repos/{$repo}/hooks", ['per_page' => 30])->json();
        } catch (GithubException) {
            return '';
        }

        $lines = collect(is_array($hooks) ? $hooks : [])->map(function (array $hook): string {
            $url = (string) ($hook['config']['url'] ?? '');
            $parts = parse_url($url);
            // * Host and path only: a query string or userinfo in a webhook URL can hold a secret.
            $safe = isset($parts['host']) ? ($parts['scheme'] ?? 'https').'://'.$parts['host'].($parts['path'] ?? '') : '(không rõ)';

            return '- '.$safe.' · sự kiện: '.implode(', ', (array) ($hook['events'] ?? [])).' · '.(($hook['active'] ?? false) ? 'đang bật' : 'đang tắt');
        })->all();

        return $lines === [] ? '' : "Webhook của repo:\n".implode("\n", $lines);
    }

    /** @param  array<string, mixed>  $query */
    private function get(string $path, array $query = [], string $accept = 'application/vnd.github+json'): Response
    {
        $token = $this->token();

        if ($token === null) {
            throw new GithubException(GithubException::NOT_CONNECTED);
        }

        try {
            $response = $this->http($token, $accept)->get(self::API.$path, $query);
        } catch (ConnectionException) {
            throw new GithubException(GithubException::UNREACHABLE);
        }

        return match (true) {
            $response->successful() => $response,
            $response->status() === 401 => throw new GithubException(GithubException::UNAUTHORIZED),
            in_array($response->status(), [403, 404], true) => throw new GithubException(GithubException::NOT_FOUND, $response->status()),
            default => throw new GithubException(GithubException::FAILED),
        };
    }

    private function http(string $token, string $accept): PendingRequest
    {
        return Http::withToken($token)->withHeaders(['Accept' => $accept, 'X-GitHub-Api-Version' => '2022-11-28'])->timeout(10)->connectTimeout(5);
    }
}
