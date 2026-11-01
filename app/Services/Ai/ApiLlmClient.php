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

        if ($response->status() === 429) {
            throw new AiException(AiException::QUOTA);
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
