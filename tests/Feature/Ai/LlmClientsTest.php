<?php

declare(strict_types=1);

namespace Tests\Feature\Ai;

use App\Services\Ai\AiException;
use App\Services\Ai\AnthropicClient;
use App\Services\Ai\ApiLlmClient;
use App\Services\Ai\DeepSeekClient;
use App\Services\Ai\GeminiClient;
use App\Services\Ai\OpenAiClient;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class LlmClientsTest extends TestCase
{
    private const KEY = 'sk-test-SECRET-1234567890';

    /** @return array<string, array{class-string<ApiLlmClient>, string, array<string, mixed>}> */
    public static function vendors(): array
    {
        return [
            'anthropic' => [AnthropicClient::class, 'api.anthropic.com/*', ['content' => [['text' => ' Xin chào ']]]],
            'openai' => [OpenAiClient::class, 'api.openai.com/*', ['choices' => [['message' => ['content' => ' Xin chào ']]]]],
            'deepseek' => [DeepSeekClient::class, 'api.deepseek.com/*', ['choices' => [['message' => ['content' => ' Xin chào ']]]]],
            'gemini' => [GeminiClient::class, 'generativelanguage.googleapis.com/*', ['candidates' => [['content' => ['parts' => [['text' => ' Xin chào ']]]]]]],
        ];
    }

    /** @param class-string<ApiLlmClient> $class @param array<string, mixed> $body */
    #[DataProvider('vendors')]
    public function test_success_returns_trimmed_text_and_keeps_the_key_out_of_the_url(string $class, string $pattern, array $body): void
    {
        Http::fake([$pattern => Http::response($body)]);

        $this->assertSame('Xin chào', (new $class(self::KEY))->complete('system', 'prompt'));

        Http::assertSent(fn (Request $request): bool => ! str_contains($request->url(), self::KEY) && str_contains(json_encode($request->headers()), self::KEY) && $request->method() === 'POST');
    }

    /** @param class-string<ApiLlmClient> $class @param array<string, mixed> $body */
    #[DataProvider('vendors')]
    public function test_401_is_a_fixed_message_without_the_key(string $class, string $pattern, array $body): void
    {
        Http::fake([$pattern => Http::response(['error' => 'bad key '.self::KEY], 401)]);

        try {
            (new $class(self::KEY))->complete('system', 'prompt');
            $this->fail('Expected AiException');
        } catch (AiException $exception) {
            $this->assertSame(AiException::UNAUTHORIZED, $exception->getMessage());
            $this->assertStringNotContainsString(self::KEY, (string) $exception);
        }
    }

    /** @param class-string<ApiLlmClient> $class @param array<string, mixed> $body */
    #[DataProvider('vendors')]
    public function test_timeout_is_a_fixed_message_without_the_url(string $class, string $pattern, array $body): void
    {
        Http::fake([$pattern => fn () => throw new ConnectionException('cURL error for https://x/?key='.self::KEY)]);

        try {
            (new $class(self::KEY))->complete('system', 'prompt');
            $this->fail('Expected AiException');
        } catch (AiException $exception) {
            $this->assertSame(AiException::TIMEOUT, $exception->getMessage());
            $this->assertNull($exception->getPrevious());
            $this->assertStringNotContainsString(self::KEY, (string) $exception);
        }
    }

    public function test_quota_and_server_errors_are_distinct_fixed_messages(): void
    {
        Http::fake(['api.openai.com/*' => Http::sequence()->push([], 429)->push([], 500)->push(['choices' => []], 200)]);

        $messages = [];

        foreach (range(1, 3) as $ignored) {
            try {
                (new OpenAiClient(self::KEY))->complete('s', 'p');
            } catch (AiException $exception) {
                $messages[] = $exception->getMessage();
            }
        }

        $this->assertSame([AiException::QUOTA, AiException::FAILED, AiException::EMPTY], $messages);
    }

    public function test_gemini_rejects_a_model_that_would_alter_the_url_path(): void
    {
        Http::fake();

        $this->expectExceptionMessage(AiException::FAILED);

        (new GeminiClient(self::KEY, '../evil?x=1'))->complete('s', 'p');
    }

    public function test_the_configured_model_is_sent(): void
    {
        Http::fake(['api.anthropic.com/*' => Http::response(['content' => [['text' => 'ok']]])]);

        (new AnthropicClient(self::KEY, 'claude-custom'))->complete('s', 'p');

        Http::assertSent(fn (Request $request): bool => $request['model'] === 'claude-custom');
    }
}
