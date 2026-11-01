<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * * Shared HTTP flow of the API vendors; each subclass only knows its request and where the text sits in the answer.
 * ! The key is sent in a header, never in the URL, and neither the exception nor the response body is ever surfaced.
 */
abstract class ApiLlmClient implements LlmClient
{
    private const TIMEOUT_SECONDS = 60;

    private const CONNECT_TIMEOUT_SECONDS = 10;

    public const MAX_OUTPUT_TOKENS = 1024;

    protected const DEFAULT_MODEL = '';

    protected readonly string $model;

    public function __construct(protected readonly string $apiKey, ?string $model = null)
    {
        $this->model = filled($model) ? $model : static::DEFAULT_MODEL;
    }

    /** The error `code`/`type` fields (never the message text) name a quota or rate-limit stop: `insufficient_quota`, `rate_limit_exceeded`, `rate_limit_error`. */
    private function quotaCode(Response $response): bool
    {
        foreach (['error.code', 'error.type'] as $key) {
            $value = $response->json($key);

            if (is_string($value) && preg_match('/insufficient_quota|rate_limit/i', $value) === 1) {
                return true;
            }
        }

        return false;
    }

    /** The scope and reset time a limit response states: its `Retry-After`/`retry_after` and error message are only parsed, never kept. */
    private function limitOf(Response $response): QuotaLimit
    {
        $message = $response->json('error.message');
        $field = $response->json('error.retry_after') ?? $response->json('retry_after');

        return QuotaLimit::parse(is_string($message) ? $message : '', $response->header('Retry-After') ?: (is_int($field) || is_string($field) ? (string) $field : null));
    }

    public function complete(string $system, string $prompt): string
    {
        try {
            $response = $this->dispatch(
                Http::timeout(self::TIMEOUT_SECONDS)->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)->acceptJson()->asJson(),
                $system,
                $prompt,
            );
        } catch (ConnectionException) {
            throw new AiException(AiException::TIMEOUT);
        }

        if (in_array($response->status(), [401, 403], true)) {
            throw new AiException(AiException::UNAUTHORIZED);
        }

        // * Quota only from a real signal: HTTP 429 (rate limit) or 402 (payment required), or the vendor's own error code/type saying so.
        if (in_array($response->status(), [402, 429], true) || (! $response->successful() && $this->quotaCode($response))) {
            throw new AiException(AiException::QUOTA, $this->limitOf($response));
        }

        if (! $response->successful()) {
            throw new AiException(AiException::FAILED);
        }

        $text = $this->extract($response);

        if (! is_string($text) || trim($text) === '') {
            throw new AiException(AiException::EMPTY);
        }

        return trim($text);
    }

    /** @throws ConnectionException */
    abstract protected function dispatch(PendingRequest $http, string $system, string $prompt): Response;

    abstract protected function extract(Response $response): mixed;
}
