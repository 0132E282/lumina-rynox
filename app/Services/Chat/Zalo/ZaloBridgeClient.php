<?php

declare(strict_types=1);

namespace App\Services\Chat\Zalo;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

/**
 * Signed HTTP client for the loopback Zalo sidecar. It never retries and never logs a request or response body.
 * ! Bodies and responses carry QR images and message text: do not log them and do not surface a `ConnectionException` message.
 */
final class ZaloBridgeClient
{
    private const CONNECT_TIMEOUT_SECONDS = 1;

    private const HEALTH_TIMEOUT_SECONDS = 2;

    private const QR_TIMEOUT_SECONDS = 5;

    private const SEND_TIMEOUT_SECONDS = 15;

    // * The sidecar fetches groups in small batches with pauses, so a large address book takes a while.
    private const CONTACTS_TIMEOUT_SECONDS = 60;

    /**
     * Without `$accountKey` the answer is the sidecar's overall state (`accounts` lists every session).
     *
     * @return array{state: string, account: array{uid: string, name: string|null}|null, version: string|null}
     *
     * @throws ConnectionException
     * @throws ZaloBridgeException
     */
    public function health(?string $accountKey = null): array
    {
        $data = $this->call('GET', '/health'.$this->accountQuery($accountKey), null, self::HEALTH_TIMEOUT_SECONDS);
        $account = is_array($data['account'] ?? null) && is_string($data['account']['uid'] ?? null)
            ? ['uid' => $data['account']['uid'], 'name' => is_string($data['account']['name'] ?? null) ? $data['account']['name'] : null]
            : null;

        return [
            'state' => is_string($data['state'] ?? null) ? $data['state'] : 'idle',
            'account' => $account,
            'version' => is_string($data['version'] ?? null) ? $data['version'] : null,
        ];
    }

    /**
     * @return string the `login_id` of the new QR session
     *
     * @throws ConnectionException
     * @throws ZaloBridgeException
     */
    public function qrStart(): string
    {
        $loginId = $this->call('POST', '/qr/start', [], self::QR_TIMEOUT_SECONDS)['login_id'] ?? null;

        return is_string($loginId) && $loginId !== '' ? $loginId : throw new ZaloBridgeException(502);
    }

    /**
     * @return array{state: string, image: string|null, error_code: string|null, account_key: string|null}
     *
     * @throws ConnectionException
     * @throws ZaloBridgeException
     */
    public function qrStatus(string $loginId): array
    {
        $data = $this->call('GET', '/qr/status?'.http_build_query(['login_id' => $loginId]), null, self::QR_TIMEOUT_SECONDS);

        return [
            'state' => is_string($data['state'] ?? null) ? $data['state'] : 'error',
            'image' => is_string($data['image'] ?? null) ? $data['image'] : null,
            'error_code' => is_string($data['error_code'] ?? null) ? $data['error_code'] : null,
            // * Only known once the sign-in finished (`logged_in`): the Zalo uid that keys the new session.
            'account_key' => is_string($data['account_key'] ?? null) && $data['account_key'] !== '' ? $data['account_key'] : null,
        ];
    }

    /**
     * @throws ConnectionException
     * @throws ZaloBridgeException
     */
    public function qrCancel(string $loginId): void
    {
        $this->call('POST', '/qr/cancel', ['login_id' => $loginId], self::QR_TIMEOUT_SECONDS);
    }

    /**
     * @return string|null the Zalo message id, when the sidecar knows it
     *
     * @throws ConnectionException
     * @throws ZaloBridgeException
     */
    public function send(string $accountKey, string $threadId, string $threadType, string $text): ?string
    {
        $data = $this->call('POST', '/send', ['account' => $accountKey, 'thread_id' => $threadId, 'thread_type' => $threadType, 'text' => $text], self::SEND_TIMEOUT_SECONDS);
        $messageId = $data['message_id'] ?? null;

        return is_string($messageId) && $messageId !== '' ? $messageId : null;
    }

    /**
     * Address book (friends and groups) of one account in one call; names only, never messages. The sidecar caches the answer for a few minutes.
     *
     * @return array{contacts: list<array{thread_id: string, type: string, name: string}>, truncated: bool}
     *
     * @throws ConnectionException
     * @throws ZaloBridgeException
     */
    public function contacts(string $accountKey): array
    {
        $data = $this->call('GET', '/contacts'.$this->accountQuery($accountKey), null, self::CONTACTS_TIMEOUT_SECONDS);
        $contacts = [];

        foreach (is_array($data['contacts'] ?? null) ? $data['contacts'] : [] as $contact) {
            if (is_array($contact) && is_string($contact['thread_id'] ?? null) && in_array($contact['type'] ?? null, ['user', 'group'], true)) {
                $contacts[] = [
                    'thread_id' => $contact['thread_id'],
                    'type' => $contact['type'],
                    'name' => is_string($contact['name'] ?? null) ? $contact['name'] : '',
                ];
            }
        }

        return ['contacts' => $contacts, 'truncated' => ($data['truncated'] ?? false) === true];
    }

    /**
     * @throws ConnectionException
     * @throws ZaloBridgeException
     */
    public function logout(string $accountKey): void
    {
        $this->call('POST', '/logout', ['account' => $accountKey], self::QR_TIMEOUT_SECONDS);
    }

    private function accountQuery(?string $accountKey): string
    {
        return $accountKey === null ? '' : '?'.http_build_query(['account' => $accountKey]);
    }

    /**
     * @param  array<string, mixed>|null  $payload
     * @return array<string, mixed>
     *
     * @throws ConnectionException
     * @throws ZaloBridgeException
     */
    private function call(string $method, string $path, ?array $payload, int $timeoutSeconds): array
    {
        $secret = (string) config('services.zalo_bridge.secret');

        if ($secret === '') {
            throw new ZaloBridgeException(503);
        }

        $body = $payload === null ? '' : json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $timestamp = time();
        $request = $this->request($timeoutSeconds)->withHeaders([
            'X-Bridge-Timestamp' => (string) $timestamp,
            'X-Bridge-Signature' => BridgeSignature::sign($secret, $timestamp, $method, $path, $body),
        ]);

        if ($payload !== null) {
            $request = $request->withBody($body, 'application/json');
        }

        $response = $request->send($method, rtrim((string) config('services.zalo_bridge.url'), '/').$path);

        if (! $response->successful()) {
            $code = $response->json('code');

            throw new ZaloBridgeException($response->status(), is_string($code) && in_array($code, ZaloBridgeException::CODES, true) ? $code : null);
        }

        $data = $response->json();

        return is_array($data) ? $data : [];
    }

    private function request(int $timeoutSeconds): PendingRequest
    {
        return Http::timeout($timeoutSeconds)->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)->acceptJson();
    }
}
