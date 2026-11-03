<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * The only place that writes to GitHub: after the person approves, one new branch + the file commits + one pull request. Never touches the base branch directly.
 * ! The token stays on the server and no response body or URL is passed on: only fixed texts and the pull request URL.
 */
class GithubWriter
{
    private const API = 'https://api.github.com';

    public function __construct(private readonly GithubReader $reader) {}

    /**
     * @param  list<array{path: string, content: string, sha: string|null}>  $files
     * @return string URL of the new pull request
     *
     * @throws GithubException
     */
    public function openPullRequest(string $repo, string $base, string $branch, string $title, string $body, array $files): string
    {
        $sha = (string) $this->send('GET', "/repos/{$repo}/git/ref/heads/".rawurlencode($base))->json('object.sha');

        $this->send('POST', "/repos/{$repo}/git/refs", ['ref' => "refs/heads/{$branch}", 'sha' => $sha]);

        foreach ($files as $file) {
            $encoded = implode('/', array_map('rawurlencode', explode('/', $file['path'])));
            $payload = [
                'message' => ($file['sha'] === null ? 'AI: thêm ' : 'AI: cập nhật ').$file['path'],
                'content' => base64_encode($file['content']),
                'branch' => $branch,
            ];

            if ($file['sha'] !== null) {
                $payload['sha'] = $file['sha'];
            }

            $this->send('PUT', "/repos/{$repo}/contents/{$encoded}", $payload);
        }

        $url = $this->send('POST', "/repos/{$repo}/pulls", ['title' => $title, 'head' => $branch, 'base' => $base, 'body' => $body])->json('html_url');

        if (! is_string($url) || ! str_starts_with($url, 'https://github.com/')) {
            throw new GithubException(GithubException::FAILED);
        }

        return $url;
    }

    /**
     * A pull request from a branch that is already pushed (a local folder pushes its own branch).
     *
     * @return string URL of the new pull request
     *
     * @throws GithubException
     */
    public function pullRequestFor(string $repo, string $base, string $head, string $title, string $body): string
    {
        $url = $this->send('POST', "/repos/{$repo}/pulls", ['title' => $title, 'head' => $head, 'base' => $base, 'body' => $body])->json('html_url');

        if (! is_string($url) || ! str_starts_with($url, 'https://github.com/')) {
            throw new GithubException(GithubException::FAILED);
        }

        return $url;
    }

    /** @param  array<string, mixed>|null  $payload */
    private function send(string $method, string $path, ?array $payload = null): Response
    {
        $token = $this->reader->token();

        if ($token === null) {
            throw new GithubException(GithubException::NOT_CONNECTED);
        }

        $request = Http::withToken($token)->withHeaders(['Accept' => 'application/vnd.github+json', 'X-GitHub-Api-Version' => '2022-11-28'])->timeout(15)->connectTimeout(5);

        try {
            $response = match ($method) {
                'GET' => $request->get(self::API.$path),
                'PUT' => $request->put(self::API.$path, $payload),
                default => $request->post(self::API.$path, $payload),
            };
        } catch (ConnectionException) {
            throw new GithubException(GithubException::UNREACHABLE);
        }

        return match (true) {
            $response->successful() => $response,
            $response->status() === 401 => throw new GithubException(GithubException::UNAUTHORIZED),
            in_array($response->status(), [403, 404], true) => throw new GithubException($method === 'GET' ? GithubException::NOT_FOUND : GithubException::WRITE_DENIED),
            $response->status() === 422 || $response->status() === 409 => throw new GithubException(GithubException::REJECTED),
            default => throw new GithubException(GithubException::FAILED),
        };
    }
}
