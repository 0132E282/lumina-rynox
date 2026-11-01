<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;

/** * Gemini `generateContent` (Generative Language API). The key goes in the `x-goog-api-key` header, not the query string. */
final class GeminiClient extends ApiLlmClient
{
    // * Unverified default: set `Mô hình` on the integration to pin a model.
    protected const DEFAULT_MODEL = 'gemini-2.0-flash';

    protected function dispatch(PendingRequest $http, string $system, string $prompt): Response
    {
        // * The model name becomes part of the URL path, so only plain model ids are accepted.
        if (preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]*$/', $this->model) !== 1) {
            throw new AiException(AiException::FAILED);
        }

        return $http->withHeaders(['x-goog-api-key' => $this->apiKey])->post("https://generativelanguage.googleapis.com/v1beta/models/{$this->model}:generateContent", [
            'systemInstruction' => ['parts' => [['text' => $system]]],
            'contents' => [['role' => 'user', 'parts' => [['text' => $prompt]]]],
            'generationConfig' => ['maxOutputTokens' => self::MAX_OUTPUT_TOKENS],
        ]);
    }

    protected function extract(Response $response): mixed
    {
        return $response->json('candidates.0.content.parts.0.text');
    }
}
