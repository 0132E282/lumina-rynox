<?php

declare(strict_types=1);

namespace App\Services\Chat\Telegram;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Thin wrapper over the Telegram Bot API. It never retries.
 * ! The token is part of the request URL: never log it and never surface a `ConnectionException` message (it contains the URL).
 */
final class TelegramClient
{
    private const BASE_URL = 'https://api.telegram.org';

    private const SEND_TIMEOUT_SECONDS = 10;

    private const CONNECT_TIMEOUT_SECONDS = 3;

    public function __construct(private readonly string $token) {}

    /**
     * @return list<array<string, mixed>>
     *
     * @throws ConnectionException
     * @throws TelegramApiException
     */
    public function getUpdates(int $offset, int $pollSeconds): array
    {
        $response = $this->request($pollSeconds + 5)->get($this->url('getUpdates'), [
            'offset' => $offset,
            'timeout' => $pollSeconds,
            'limit' => 100,
            'allowed_updates' => json_encode(['message']),
        ]);

        return array_values($this->result($response)) ?: [];
    }

    /**
     * @return array<string, mixed> the sent message
     *
     * @throws ConnectionException
     * @throws TelegramApiException
     */
    public function sendMessage(string $chatId, string $text): array
    {
        $response = $this->request(self::SEND_TIMEOUT_SECONDS)->post($this->url('sendMessage'), [
            'chat_id' => $chatId,
            'text' => $text,
        ]);

        return $this->result($response);
    }

    private function request(int $timeoutSeconds): PendingRequest
    {
        return Http::timeout($timeoutSeconds)
            ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
            ->acceptJson();
    }

    private function url(string $method): string
    {
        return self::BASE_URL."/bot{$this->token}/{$method}";
    }

    /**
     * @return array<mixed>
     *
     * @throws TelegramApiException
     */
    private function result(Response $response): array
    {
        if (! $response->successful() || $response->json('ok') !== true) {
            $description = $response->json('description');

            throw new TelegramApiException(
                $response->status(),
                is_string($description) ? $description : "Telegram trả về lỗi (HTTP {$response->status()}).",
            );
        }

        $result = $response->json('result');

        return is_array($result) ? $result : [];
    }
}
