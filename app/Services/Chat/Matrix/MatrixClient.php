<?php

declare(strict_types=1);

namespace App\Services\Chat\Matrix;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Matrix Client-Server API client for the app's own Matrix user (`services.matrix`): reads and sends into bridge
 * portal rooms. It never retries and never logs a request or response body (room content, access token).
 */
final class MatrixClient
{
    private const CONNECT_TIMEOUT_SECONDS = 1;

    private const WHOAMI_TIMEOUT_SECONDS = 2;

    private const JOIN_TIMEOUT_SECONDS = 5;

    private const SEND_TIMEOUT_SECONDS = 15;

    private const MEDIA_TIMEOUT_SECONDS = 15;

    private const UPLOAD_TIMEOUT_SECONDS = 60;

    private const MXC_PATTERN = '#^mxc://([A-Za-z0-9.:\-]+)/([A-Za-z0-9_\-]+)$#D';

    private const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    public const AUDIO_MIMES = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/webm'];

    public const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];

    // * `/sync` long-polls for `timeoutMs` on the homeserver's side; this margin keeps the HTTP client from cutting it short.
    private const SYNC_EXTRA_SECONDS = 10;

    /**
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function whoami(): string
    {
        $data = $this->call('GET', '/_matrix/client/v3/account/whoami', null, self::WHOAMI_TIMEOUT_SECONDS);
        $userId = $data['user_id'] ?? null;

        return is_string($userId) && $userId !== '' ? $userId : throw new MatrixException(502);
    }

    /**
     * @param  array<string, mixed>  $filter
     * @return array<string, mixed> the raw `/sync` response
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function sync(?string $since, int $timeoutMs, array $filter): array
    {
        $query = ['timeout' => $timeoutMs, 'filter' => json_encode($filter, JSON_THROW_ON_ERROR)];

        if ($since !== null) {
            $query['since'] = $since;
        }

        $timeoutSeconds = (int) ceil($timeoutMs / 1000) + self::SYNC_EXTRA_SECONDS;

        return $this->call('GET', '/_matrix/client/v3/sync?'.http_build_query($query), null, $timeoutSeconds);
    }

    /**
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function join(string $roomId): void
    {
        $this->call('POST', '/_matrix/client/v3/join/'.rawurlencode($roomId), [], self::JOIN_TIMEOUT_SECONDS);
    }

    /**
     * @return string the `event_id` the homeserver assigned
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function sendText(string $roomId, string $txnId, string $body): string
    {
        $path = '/_matrix/client/v3/rooms/'.rawurlencode($roomId).'/send/m.room.message/'.rawurlencode($txnId);
        $data = $this->call('PUT', $path, ['msgtype' => 'm.text', 'body' => $body], self::SEND_TIMEOUT_SECONDS);
        $eventId = $data['event_id'] ?? null;

        return is_string($eventId) && $eventId !== '' ? $eventId : throw new MatrixException(502);
    }

    /**
     * Uploads raw bytes to the homeserver's media repository.
     *
     * @return string the `mxc://` URI of the stored file
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function uploadMedia(string $data, string $mime, string $filename): string
    {
        $baseUrl = (string) config('services.matrix.homeserver_url');
        $accessToken = (string) config('services.matrix.access_token');

        if ($baseUrl === '' || $accessToken === '') {
            throw MatrixException::notConfigured();
        }

        $response = Http::timeout(self::UPLOAD_TIMEOUT_SECONDS)
            ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
            ->acceptJson()
            ->withToken($accessToken)
            ->withBody($data, $mime)
            ->post(rtrim($baseUrl, '/').'/_matrix/media/v3/upload?filename='.rawurlencode($filename));

        if (! $response->successful()) {
            throw new MatrixException($response->status(), $this->errcode($response->json()));
        }

        $uri = $response->json('content_uri');

        return is_string($uri) && preg_match(self::MXC_PATTERN, $uri) === 1 ? $uri : throw new MatrixException(502);
    }

    /**
     * Sends an uploaded file as `m.image` or `m.file`; a caption goes out as a separate text message by the caller.
     *
     * @param  array{mime: string, size: int, width?: int|null, height?: int|null}  $info
     * @return string the `event_id` the homeserver assigned
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function sendFile(string $roomId, string $txnId, string $mxcUri, string $filename, array $info): string
    {
        $isImage = str_starts_with($info['mime'], 'image/');
        $isAudio = in_array($info['mime'], self::AUDIO_MIMES, true);
        $content = [
            'msgtype' => $isImage ? 'm.image' : ($isAudio ? 'm.audio' : 'm.file'),
            'body' => $filename,
            'url' => $mxcUri,
            'info' => array_filter([
                'mimetype' => $info['mime'],
                'size' => $info['size'],
                'w' => $isImage ? ($info['width'] ?? null) : null,
                'h' => $isImage ? ($info['height'] ?? null) : null,
            ], fn ($value) => $value !== null),
        ];
        // * Marks the clip as a voice message (MSC3245) so the bridge sends it as one.
        if ($isAudio) {
            $content['org.matrix.msc3245.voice'] = (object) [];
        }

        $path = '/_matrix/client/v3/rooms/'.rawurlencode($roomId).'/send/m.room.message/'.rawurlencode($txnId);
        $data = $this->call('PUT', $path, $content, self::SEND_TIMEOUT_SECONDS);
        $eventId = $data['event_id'] ?? null;

        return is_string($eventId) && $eventId !== '' ? $eventId : throw new MatrixException(502);
    }

    /**
     * Downloads an `mxc://` image through the authenticated media endpoint. The type is decided from the bytes (never
     * from the sender's or the server's declared type) and only jpeg/png/gif/webp within `$maxBytes` is accepted.
     * Nothing about the URI, the token or the body is logged or put in an exception message.
     *
     * @return array{data: string, mime: string, width: int, height: int}
     *
     * @throws ConnectionException
     * @throws MatrixException 413 too large, 415 not an allowed image, 400 malformed URI, otherwise the upstream status
     */
    public function downloadImage(string $mxcUri, int $maxBytes): array
    {
        $data = $this->downloadMedia($mxcUri, $maxBytes);

        $info = $data === '' ? false : @getimagesizefromstring($data);

        if ($info === false || ! in_array($info['mime'] ?? null, self::IMAGE_MIMES, true) || $info[0] < 1 || $info[1] < 1) {
            throw new MatrixException(415);
        }

        return ['data' => $data, 'mime' => $info['mime'], 'width' => $info[0], 'height' => $info[1]];
    }

    /**
     * One room event by id (used to recover the media reference of a voice message saved before it was supported).
     *
     * @return array<string, mixed>
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    public function event(string $roomId, string $eventId): array
    {
        return $this->call('GET', '/_matrix/client/v3/rooms/'.rawurlencode($roomId).'/event/'.rawurlencode($eventId), null, self::SEND_TIMEOUT_SECONDS);
    }

    /**
     * Opens an `mxc://` file as a stream (nothing is stored) so it can be relayed to the browser, which cannot send the
     * access token itself. `$range` is the browser's `Range` header, passed on so audio can seek.
     *
     * @throws ConnectionException
     * @throws MatrixException 400 malformed URI, otherwise the upstream status
     */
    public function streamMedia(string $mxcUri, ?string $range): Response
    {
        if (preg_match(self::MXC_PATTERN, $mxcUri, $parts) !== 1) {
            throw new MatrixException(400);
        }

        $baseUrl = (string) config('services.matrix.homeserver_url');
        $accessToken = (string) config('services.matrix.access_token');

        if ($baseUrl === '' || $accessToken === '') {
            throw MatrixException::notConfigured();
        }

        $path = '/_matrix/client/v1/media/download/'.rawurlencode($parts[1]).'/'.rawurlencode($parts[2]);
        $response = Http::timeout(self::MEDIA_TIMEOUT_SECONDS)
            ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
            ->withToken($accessToken)
            ->withHeaders($range === null ? [] : ['Range' => $range])
            ->withOptions(['stream' => true])
            ->get(rtrim($baseUrl, '/').$path);

        if (! $response->successful()) {
            throw new MatrixException($response->status(), $this->errcode($response->json()));
        }

        return $response;
    }

    /**
     * @throws ConnectionException
     * @throws MatrixException
     */
    private function downloadMedia(string $mxcUri, int $maxBytes): string
    {
        if (preg_match(self::MXC_PATTERN, $mxcUri, $parts) !== 1) {
            throw new MatrixException(400);
        }

        $baseUrl = (string) config('services.matrix.homeserver_url');
        $accessToken = (string) config('services.matrix.access_token');

        if ($baseUrl === '' || $accessToken === '') {
            throw MatrixException::notConfigured();
        }

        $path = '/_matrix/client/v1/media/download/'.rawurlencode($parts[1]).'/'.rawurlencode($parts[2]);
        $response = Http::timeout(self::MEDIA_TIMEOUT_SECONDS)
            ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
            ->withToken($accessToken)
            ->withOptions(['stream' => true])
            ->get(rtrim($baseUrl, '/').$path);

        if (! $response->successful()) {
            throw new MatrixException($response->status(), $this->errcode($response->json()));
        }

        $declaredLength = (int) $response->header('Content-Length');

        if ($declaredLength > $maxBytes) {
            throw new MatrixException(413);
        }

        // * The length header can be absent or false: read at most one byte past the limit and stop.
        $stream = $response->toPsrResponse()->getBody();
        $data = '';

        while (! $stream->eof() && strlen($data) <= $maxBytes) {
            $data .= $stream->read(8192);
        }

        if (strlen($data) > $maxBytes) {
            throw new MatrixException(413);
        }

        return $data;
    }

    /**
     * @param  array<string, mixed>|null  $payload
     * @return array<string, mixed>
     *
     * @throws ConnectionException
     * @throws MatrixException
     */
    private function call(string $method, string $path, ?array $payload, int $timeoutSeconds): array
    {
        $baseUrl = (string) config('services.matrix.homeserver_url');
        $accessToken = (string) config('services.matrix.access_token');

        if ($baseUrl === '' || $accessToken === '') {
            throw MatrixException::notConfigured();
        }

        $request = Http::timeout($timeoutSeconds)->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)->acceptJson()->withToken($accessToken);

        if ($payload !== null) {
            // * An empty payload must go out as `{}`: PHP would encode `[]` as a JSON array, which the homeserver rejects ("Content must be a JSON object").
            $body = $payload === [] ? '{}' : json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $request = $request->withBody($body, 'application/json');
        }

        $response = $request->send($method, rtrim($baseUrl, '/').$path);

        if (! $response->successful()) {
            throw new MatrixException($response->status(), $this->errcode($response->json()));
        }

        $data = $response->json();

        return is_array($data) ? $data : throw new MatrixException(502);
    }

    private function errcode(mixed $data): ?string
    {
        return is_array($data) && is_string($data['errcode'] ?? null) ? $data['errcode'] : null;
    }
}
