<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;

/** * Claude through the Anthropic Messages API (`POST /v1/messages`, `x-api-key` + `anthropic-version`). */
final class AnthropicClient extends ApiLlmClient
{
    // * Unverified default: set `Mô hình` on the integration to pin a model.
    protected const DEFAULT_MODEL = 'claude-sonnet-4-5';

    protected function dispatch(PendingRequest $http, string $system, string $prompt): Response
    {
        return $http->withHeaders(['x-api-key' => $this->apiKey, 'anthropic-version' => '2023-06-01'])->post('https://api.anthropic.com/v1/messages', [
            'model' => $this->model,
            'max_tokens' => self::MAX_OUTPUT_TOKENS,
            'system' => $system,
            'messages' => [['role' => 'user', 'content' => $prompt]],
        ]);
    }

    protected function extract(Response $response): mixed
    {
        return $response->json('content.0.text');
    }
}
