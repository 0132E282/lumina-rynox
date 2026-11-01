<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\Integration;
use App\Models\Post;
use App\Models\PostTarget;
use Closure;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Shared flow of the platform publishers: read the stored connection, refuse before any request when it is incomplete,
 * then classify HTTP outcomes. Timeouts and 5xx on the request that creates the post are `unknown` (never retried here);
 * the same on an earlier step (e.g. an image upload) is `failed`, because nothing was published yet.
 * ! Tokens never go into messages, logs or exceptions: only the fixed texts below and the platform's own error message are kept.
 */
abstract class BasePublisher implements PostPublisher
{
    public const INSUFFICIENT_CREDENTIALS = 'Chưa đủ thông tin kết nối để đăng';

    private const MESSAGE_LENGTH = 300;

    // * Target being published, for publishers that read per-target options (e.g. audience).
    protected ?PostTarget $target = null;

    /** @return string key in `integrations.provider` */
    abstract protected function integrationKey(): string;

    abstract protected function platformName(): string;

    /**
     * * Credentials this publisher needs: name => `secret` (encrypted `credentials`) or `field` (plain `settings.fields`).
     * * These keys must exist in the provider's form in config/integrations.php, or the platform is never usable.
     *
     * @return array<string, 'secret'|'field'>
     */
    abstract protected function requiredCredentials(): array;

    /**
     * @param  array<string, string>  $credentials
     *
     * @throws PublishAborted
     * @throws ConnectionException
     */
    abstract protected function send(Post $post, array $credentials): PublishResult;

    public function publish(PostTarget $target): PublishResult
    {
        $integration = Integration::query()->where('provider', $this->integrationKey())->first();

        if ($integration === null || $integration->status !== Integration::STATUS_CONNECTED) {
            return PublishResult::failed($this->platformName().' đang mất kết nối, chưa thể đăng.');
        }

        $credentials = $this->credentials($integration);

        if ($credentials === null) {
            return PublishResult::failed(self::INSUFFICIENT_CREDENTIALS);
        }

        $this->target = $target;

        try {
            return $this->send($target->post, $credentials);
        } catch (PublishAborted $aborted) {
            return $aborted->result();
        } catch (ConnectionException) {
            // ! The exception message holds the request URL (which can carry a token): only a fixed text is stored.
            return PublishResult::unknown('Hết thời gian chờ '.$this->platformName().', bài có thể đã được đăng.');
        }
    }

    /** @return array<string, string>|null null when any required value is missing */
    private function credentials(Integration $integration): ?array
    {
        $values = [];

        foreach ($this->requiredCredentials() as $key => $store) {
            $value = $store === 'secret'
                ? ($integration->credentials[$key] ?? null)
                : ($integration->settings['fields'][$key] ?? null);

            if (! is_string($value) || trim($value) === '') {
                return null;
            }

            $values[$key] = trim($value);
        }

        return $values;
    }

    protected function http(): PendingRequest
    {
        return Http::timeout((int) config('posting.http_timeout_seconds'))
            ->connectTimeout((int) config('posting.http_connect_timeout_seconds'))
            ->acceptJson();
    }

    /**
     * * Runs one request. `$creates` marks the call that actually publishes: only there is a timeout or 5xx ambiguous.
     * * 4xx is always `failed` with the platform's message.
     *
     * @param  Closure(): Response  $call
     *
     * @throws PublishAborted
     */
    protected function execute(Closure $call, bool $creates): Response
    {
        try {
            $response = $call();
        } catch (ConnectionException) {
            throw $creates
                ? PublishAborted::unknown('Hết thời gian chờ '.$this->platformName().', bài có thể đã được đăng.')
                : PublishAborted::failed('Không kết nối được tới '.$this->platformName().', bài chưa được đăng.');
        }

        if ($response->serverError()) {
            throw $creates
                ? PublishAborted::unknown($this->platformName().' lỗi tạm thời, bài có thể đã được đăng.')
                : PublishAborted::failed($this->platformName().' lỗi tạm thời, bài chưa được đăng.');
        }

        if ($response->failed()) {
            $prefix = in_array($response->status(), [401, 403], true) ? 'Token hết hạn hoặc thiếu quyền. ' : '';

            throw PublishAborted::failed($prefix.$this->errorMessage($response));
        }

        return $response;
    }

    private function errorMessage(Response $response): string
    {
        $message = $response->json('error.message') ?? $response->json('message') ?? 'HTTP '.$response->status();

        return Str::limit(is_string($message) ? $message : 'HTTP '.$response->status(), self::MESSAGE_LENGTH);
    }

    /** @return list<string> URLs of the post's media of one type */
    protected function mediaUrls(Post $post, string $type): array
    {
        $urls = [];

        foreach ($post->media ?? [] as $item) {
            if ($item['type'] === $type) {
                $urls[] = $item['url'];
            }
        }

        return $urls;
    }
}
