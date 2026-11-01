<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\Post;
use App\Models\PostTarget;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Personal LinkedIn feed (unofficial, text and images, no video). Everything goes through scripts/linkedin-post.mjs, which runs once
 * on THIS machine in the user's real Chrome: the composer's own request replayed inside the page (`browser-api`), or the UI (`ui`).
 * The script alone decides between them (a definitive rejection falls back to the UI inside the script); Laravel only maps its JSON.
 * Anything it could not confirm is `unknown` and is never retried. No cookie or token ever passes through PHP.
 * ! LinkedIn's terms restrict automation: the account may be restricted.
 */
final class LinkedInPersonalPublisher extends BasePublisher
{
    use PostsToGroups;

    private const VIAS = ['browser-api', 'ui'];

    private const RATE_KEY = 'linkedin-personal-post';

    // * A value that is missing or not allowed falls back to the most private one.
    private const FALLBACK_AUDIENCE = PostTarget::AUDIENCE_CONNECTIONS;

    public const NOT_LOGGED_IN = 'Chưa đăng nhập LinkedIn trên máy này, chạy pnpm linkedin:login';

    public const UNCONFIRMED = 'Chưa xác nhận được bài đã lên LinkedIn, bài có thể đã được đăng.';

    private const FAILURES = [
        'not_logged_in' => self::NOT_LOGGED_IN,
        'composer_not_found' => 'Không tìm thấy khung đăng bài của LinkedIn (giao diện có thể đã đổi), bài chưa được đăng.',
        'audience_not_set' => 'Không đặt được đối tượng xem bài trên LinkedIn, bài chưa được đăng.',
        'checkpoint' => 'LinkedIn yêu cầu xác minh, hãy xử lý trong cửa sổ Chrome rồi đăng lại. Bài chưa được đăng.',
        'browser_unavailable' => 'Không mở được Chrome trên máy này (chưa cài Chrome hoặc hồ sơ đang mở ở cửa sổ khác), bài chưa được đăng.',
        'invalid_input' => 'Nội dung bài không hợp lệ cho LinkedIn cá nhân, bài chưa được đăng.',
        'image_download_failed' => 'Không tải được ảnh của bài để đăng lên LinkedIn cá nhân (link hỏng, quá 10MB hoặc không phải ảnh), bài chưa được đăng.',
        'image_upload_failed' => 'Không đính kèm được ảnh vào khung đăng bài của LinkedIn (giao diện có thể đã đổi), bài chưa được đăng.',
    ];

    public function __construct(
        private readonly LinkedInBrowserScript $script = new LinkedInBrowserScript,
        private readonly LinkedInWebClient $web = new LinkedInWebClient,
    ) {}

    protected function integrationKey(): string
    {
        return 'linkedin_personal';
    }

    protected function platformName(): string
    {
        return 'LinkedIn cá nhân';
    }

    protected function requiredCredentials(): array
    {
        return [];
    }

    protected function send(Post $post, array $credentials): PublishResult
    {
        if ($this->mediaUrls($post, 'video') !== []) {
            throw PublishAborted::failed('Chưa hỗ trợ video cho LinkedIn cá nhân, chỉ đăng được ảnh.');
        }

        $images = $this->mediaUrls($post, 'image');

        if ($this->target?->social_group_id !== null) {
            return $this->sendToGroup($post, $images);
        }

        $limit = (int) config('posting.providers.linkedin_personal.posts_per_hour', 3);

        if (RateLimiter::tooManyAttempts(self::RATE_KEY, $limit)) {
            throw PublishAborted::failed('Đã đạt giới hạn số bài LinkedIn cá nhân mỗi giờ.');
        }

        $allowed = array_keys((array) config('posting.providers.linkedin_personal.audiences', []));
        $audience = $this->target?->audience;
        $audience = in_array($audience, $allowed, true) ? $audience : self::FALLBACK_AUDIENCE;

        $cookie = $this->webCookie();

        // * Public text posts go straight to LinkedIn over HTTP when a cookie is configured; images and the "connections" audience still use the script.
        if ($images === [] && $audience === PostTarget::AUDIENCE_PUBLIC && LinkedInWebClient::usable($cookie)) {
            return $this->counted($this->viaWeb($post, (string) $cookie));
        }

        $input = ['text' => $post->body, 'audience' => $audience];

        if ($images !== []) {
            $input['images'] = $images;
        }

        $outcome = $this->script->run('post', $input);

        return $this->counted(match ($outcome['status']) {
            'ok' => $this->published($outcome['payload']),
            'no_node' => PublishResult::failed('Không chạy được Node trên máy này, bài chưa được đăng.'),
            'error' => $this->failure((string) ($outcome['payload']['error'] ?? 'unknown')),
            default => PublishResult::unknown(self::UNCONFIRMED),
        });
    }

    // * The .env value wins; otherwise the cookie saved by `pnpm linkedin:login` / `linkedin:cookie` (storage/app/linkedin-cookie.json, 0600).
    private function webCookie(): ?string
    {
        $configured = config('posting.linkedin_personal.web_cookie');

        if (is_string($configured) && $configured !== '') {
            return $configured;
        }

        $file = (string) config('posting.linkedin_personal.cookie_file');

        if ($file === '' || ! is_file($file)) {
            return null;
        }

        $data = json_decode((string) file_get_contents($file), true);

        return is_array($data) && is_string($data['cookie'] ?? null) ? $data['cookie'] : null;
    }

    private function viaWeb(Post $post, string $cookie): PublishResult
    {
        $outcome = $this->web->publishText($post->body, $cookie);

        Log::info('LinkedIn personal post sent over HTTP.', ['status' => $outcome['status']]);

        return match ($outcome['status']) {
            'ok' => PublishResult::published((string) $outcome['post_id'], $outcome['url']),
            'rejected' => PublishResult::failed('LinkedIn từ chối yêu cầu (cookie hết hạn hoặc không hợp lệ), bài chưa được đăng. Lấy lại LINKEDIN_PERSONAL_COOKIE.')->haltingBatch(),
            default => PublishResult::unknown(self::UNCONFIRMED),
        };
    }

    // * The hourly limit counts only posts that may really have gone out (published or unknown), never refused or failed attempts.
    private function counted(PublishResult $result): PublishResult
    {
        if (in_array($result->status, [PostTarget::STATUS_PUBLISHED, PostTarget::STATUS_UNKNOWN], true)) {
            RateLimiter::hit(self::RATE_KEY, 3600);
        }

        return $result;
    }

    /** @param array<string, mixed> $payload */
    private function published(array $payload): PublishResult
    {
        $url = $payload['url'] ?? null;
        $url = is_string($url) && str_starts_with($url, 'https://www.linkedin.com/') ? $url : null;
        $postId = $payload['post_id'] ?? null;
        $postId = is_string($postId) && preg_match('/^[A-Za-z0-9_:.=-]{1,150}$/', $postId) === 1 ? $postId : null;
        $via = $payload['via'] ?? null;

        // * Which path ran (browser-api = request inside Chrome, ui = composer); fixed values only, nothing else from the script's output.
        Log::info('LinkedIn personal post published.', ['via' => in_array($via, self::VIAS, true) ? $via : 'unknown']);

        return PublishResult::published($postId ?? $this->externalId($url), $url);
    }

    // * The script may not find the post link; the id then is a local marker, never a real LinkedIn id.
    private function externalId(?string $url): string
    {
        if ($url !== null) {
            $last = basename(rtrim((string) parse_url($url, PHP_URL_PATH), '/'));

            if (preg_match('/^urn:li:[A-Za-z]+:\d{5,30}$/', $last) === 1) {
                return $last;
            }
        }

        return 'local-'.now()->format('YmdHis');
    }

    private function failure(string $code): PublishResult
    {
        if (! isset(self::FAILURES[$code])) {
            return PublishResult::unknown(self::UNCONFIRMED);
        }

        $result = PublishResult::failed(self::FAILURES[$code]);

        // * A checkpoint or a logged-out profile affects every later post of this batch too.
        return in_array($code, ['checkpoint', 'not_logged_in'], true) ? $result->haltingBatch() : $result;
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{status: 'ok'|'error'|'timed_out'|'no_node'|'no_result', payload: array<string, mixed>}
     */
    private function runGroupScript(array $input): array
    {
        return $this->script->run('post', $input);
    }

    private function groupRateKey(): string
    {
        return self::RATE_KEY;
    }

    private function groupHourlyLimit(): int
    {
        return (int) config('posting.providers.linkedin_personal.posts_per_hour', 3);
    }

    private function groupUrlPattern(): string
    {
        return '#^https://www\.linkedin\.com/groups/\d{3,15}/?$#';
    }
}
