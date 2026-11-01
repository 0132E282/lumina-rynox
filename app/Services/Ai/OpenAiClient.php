<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;

/** * OpenAI Chat Completions (`POST /v1/chat/completions`, Bearer key); `DeepSeekClient` reuses the same shape on another host. */
class OpenAiClient extends ApiLlmClient
{
    // * Unverified default: set `Mô hình` on the integration to pin a model.
    protected const DEFAULT_MODEL = 'gpt-4o-mini';

    protected const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

    protected function dispatch(PendingRequest $http, string $system, string $prompt): Response
    {
        return $http->withToken($this->apiKey)->post(static::ENDPOINT, [
            'model' => $this->model,
            'max_tokens' => self::MAX_OUTPUT_TOKENS,
            'messages' => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => $prompt],
            ],
        ]);
    }

    protected function extract(Response $response): mixed
    {
        return $response->json('choices.0.message.content');
    }
}
