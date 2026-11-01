<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\Post;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

/**
 * LinkedIn REST Posts API: `access_token` + `author_urn` (e.g. `urn:li:person:…`). Images are uploaded first (`/rest/images`),
 * then `/rest/posts` creates the post; only that last request can leave the outcome `unknown`. Video is not supported.
 */
final class LinkedInPublisher extends BasePublisher
{
    private const API = 'https://api.linkedin.com/rest';

    private const MAX_IMAGE_BYTES = 10_000_000;

    // * LinkedIn "little text": these characters are markup and must be escaped to appear literally.
    private const RESERVED = '/([\\\\|{}@\[\]()<>#*_~])/';

    protected function integrationKey(): string
    {
        return 'linkedin';
    }

    protected function platformName(): string
    {
        return 'LinkedIn';
    }

    protected function requiredCredentials(): array
    {
        return ['access_token' => 'secret', 'author_urn' => 'field'];
    }

    protected function send(Post $post, array $credentials): PublishResult
    {
        if ($this->mediaUrls($post, 'video') !== []) {
            throw PublishAborted::failed('LinkedIn chưa hỗ trợ đăng video.');
        }

        $images = [];

        foreach ($this->mediaUrls($post, 'image') as $url) {
            $images[] = $this->uploadImage($url, $credentials);
        }

        $payload = [
            'author' => $credentials['author_urn'],
            'commentary' => preg_replace(self::RESERVED, '\\\\$1', $post->body),
            'visibility' => 'PUBLIC',
            'distribution' => ['feedDistribution' => 'MAIN_FEED', 'targetEntities' => [], 'thirdPartyDistributionChannels' => []],
            'lifecycleState' => 'PUBLISHED',
            'isReshareDisabledByAuthor' => false,
        ];

        if (count($images) === 1) {
            $payload['content'] = ['media' => ['id' => $images[0]]];
        } elseif ($images !== []) {
            $payload['content'] = ['multiImage' => ['images' => array_map(fn (string $urn): array => ['id' => $urn], $images)]];
        }

        $response = $this->execute(fn () => $this->api($credentials)->post(self::API.'/posts', $payload), true);
        $urn = $response->header('x-restli-id');

        if ($urn === '') {
            // ! 2xx without an id: the post exists, so this must not read as a plain failure.
            throw PublishAborted::unknown('LinkedIn phản hồi thiếu mã bài, bài có thể đã được đăng.');
        }

        return PublishResult::published($urn, 'https://www.linkedin.com/feed/update/'.$urn);
    }

    /**
     * @param  array<string, string>  $credentials
     * @return string image URN
     *
     * @throws PublishAborted
     */
    private function uploadImage(string $url, array $credentials): string
    {
        $initialized = $this->execute(
            fn () => $this->api($credentials)->post(self::API.'/images?action=initializeUpload', ['initializeUploadRequest' => ['owner' => $credentials['author_urn']]]),
            false,
        );
        $uploadUrl = $initialized->json('value.uploadUrl');
        $imageUrn = $initialized->json('value.image');

        if (! is_string($uploadUrl) || ! is_string($imageUrn)) {
            throw PublishAborted::failed('LinkedIn không cấp được chỗ tải ảnh lên.');
        }

        $source = $this->download($url);
        $this->execute(fn () => Http::timeout((int) config('posting.http_timeout_seconds'))
            ->withToken($credentials['access_token'])
            ->withBody($source['body'], $source['type'])
            ->put($uploadUrl), false);

        return $imageUrn;
    }

    /**
     * * The server fetches the image itself, so only public http(s) hosts are allowed (no private or reserved addresses, no redirects).
     *
     * @return array{body: string, type: string}
     *
     * @throws PublishAborted
     */
    private function download(string $url): array
    {
        $host = parse_url($url, PHP_URL_HOST);
        $scheme = parse_url($url, PHP_URL_SCHEME);

        if (! is_string($host) || ! in_array($scheme, ['http', 'https'], true) || ! $this->isPublicHost($host)) {
            throw PublishAborted::failed('Địa chỉ ảnh không công khai, LinkedIn không tải được.');
        }

        $response = $this->execute(fn () => Http::timeout((int) config('posting.http_timeout_seconds'))->withoutRedirecting()->get($url), false);
        $body = $response->body();

        if ($body === '' || strlen($body) > self::MAX_IMAGE_BYTES) {
            throw PublishAborted::failed('Ảnh rỗng hoặc lớn hơn 10 MB.');
        }

        return ['body' => $body, 'type' => $response->header('Content-Type') ?: 'application/octet-stream'];
    }

    private function isPublicHost(string $host): bool
    {
        $addresses = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);

        if ($addresses === []) {
            return false;
        }

        foreach ($addresses as $address) {
            if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
                return false;
            }
        }

        return true;
    }

    /** @param  array<string, string>  $credentials */
    private function api(array $credentials): PendingRequest
    {
        return $this->http()->withToken($credentials['access_token'])->withHeaders([
            'Linkedin-Version' => (string) config('posting.linkedin_version'),
            'X-Restli-Protocol-Version' => '2.0.0',
        ]);
    }
}
