<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\Post;
use App\Models\PostTarget;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Personal timeline (unofficial, text and images, no video). Three tiers for a text-only post, never skipping down after an
 * ambiguous answer: (1) plain Http POST to Facebook's GraphQL with the session and request template the script saved from the
 * user's real Chrome (`via: http`, only Cookie + form body); (2) only when tier 1 was DEFINITIVELY rejected (4xx, only `errors`,
 * or no saved session/template), scripts/facebook-post.mjs runs once on THIS machine: in-browser API (`browser-api`), then the UI
 * (`ui`), and refreshes the saved session. (3) Anything ambiguous (5xx, timeout, `data` without a post id, or a script result it
 * could not confirm) is `unknown` and is never retried. Images always go to the script. Chrome is otherwise needed only for login.
 */
final class FacebookPersonalPublisher extends BasePublisher
{
    use PostsToGroups;

    private const VIAS = ['http', 'browser-api', 'ui'];

    private const RATE_KEY = 'facebook-personal-post';

    // * Unknown values fall back to the most private one.
    private const AUDIENCES = [PostTarget::AUDIENCE_SELF, PostTarget::AUDIENCE_FRIENDS, PostTarget::AUDIENCE_PUBLIC];

    public const NOT_LOGGED_IN = 'Chưa đăng nhập Facebook trên máy này, chạy pnpm facebook:login';

    public const UNCONFIRMED = 'Chưa xác nhận được bài đã lên Facebook, bài có thể đã được đăng.';

    private const FAILURES = [
        'not_logged_in' => self::NOT_LOGGED_IN,
        'composer_not_found' => 'Không tìm thấy khung đăng bài của Facebook (giao diện có thể đã đổi), bài chưa được đăng.',
        'audience_not_set' => 'Không đặt được đối tượng xem bài trên Facebook, bài chưa được đăng.',
        'checkpoint' => 'Facebook yêu cầu xác minh, hãy xử lý trong cửa sổ Chrome rồi đăng lại. Bài chưa được đăng.',
        'browser_unavailable' => 'Không mở được Chrome trên máy này (chưa cài Chrome hoặc hồ sơ đang mở ở cửa sổ khác), bài chưa được đăng.',
        'invalid_input' => 'Nội dung bài không hợp lệ cho Facebook cá nhân, bài chưa được đăng.',
        'image_download_failed' => 'Không tải được ảnh của bài để đăng lên Facebook cá nhân (link hỏng, quá 10MB hoặc không phải ảnh), bài chưa được đăng.',
        'image_upload_failed' => 'Không đính kèm được ảnh vào khung đăng bài của Facebook (giao diện có thể đã đổi), bài chưa được đăng.',
    ];

    public function __construct(
        private readonly FacebookBrowserScript $script = new FacebookBrowserScript,
        private readonly FacebookWebSession $session = new FacebookWebSession,
    ) {}

    protected function integrationKey(): string
    {
        return 'facebook_personal';
    }

    protected function platformName(): string
    {
        return 'Facebook cá nhân';
    }

    protected function requiredCredentials(): array
    {
        return [];
    }

    protected function send(Post $post, array $credentials): PublishResult
    {
        if ($this->mediaUrls($post, 'video') !== []) {
            throw PublishAborted::failed('Chưa hỗ trợ video cho Facebook cá nhân, chỉ đăng được ảnh.');
        }

        $images = $this->mediaUrls($post, 'image');

        if ($this->target?->social_group_id !== null) {
            return $this->sendToGroup($post, $images);
        }

        $limit = (int) config('posting.providers.facebook_personal.posts_per_hour', 5);

        if (RateLimiter::tooManyAttempts(self::RATE_KEY, $limit)) {
            throw PublishAborted::failed('Đã đạt giới hạn số bài Facebook cá nhân mỗi giờ.');
        }

        $audience = $this->target?->audience;
        $audience = in_array($audience, self::AUDIENCES, true) ? $audience : PostTarget::AUDIENCE_SELF;

        if ($images === [] && ($session = $this->session->load()) !== null && ($result = $this->viaHttp($session, $post->body, $audience)) !== null) {
            return $this->counted($result);
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
        $url = is_string($url) && str_starts_with($url, 'https://www.facebook.com/') ? $url : null;
        $postId = $payload['post_id'] ?? null;
        $postId = is_string($postId) && preg_match('/^[A-Za-z0-9_=-]{1,100}$/', $postId) === 1 ? $postId : null;
        $via = $payload['via'] ?? null;

        // * Which path ran (http = Laravel request, browser-api = request inside Chrome, ui = composer); fixed values only, nothing from the script's output beyond them.
        Log::info('Facebook personal post published.', ['via' => in_array($via, self::VIAS, true) ? $via : 'unknown']);

        return PublishResult::published($postId ?? $this->externalId($url), $url);
    }

    // * The script may not find the post link; the id then is a local marker, never a real Facebook id.
    private function externalId(?string $url): string
    {
        if ($url !== null) {
            parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

            foreach (['story_fbid', 'fbid', 'id'] as $key) {
                if (isset($query[$key]) && is_string($query[$key]) && $query[$key] !== '') {
                    return $query[$key];
                }
            }

            $last = basename((string) parse_url($url, PHP_URL_PATH));

            if ($last !== '') {
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
        return (int) config('posting.providers.facebook_personal.posts_per_hour', 5);
    }

    private function groupUrlPattern(): string
    {
        return '#^https://www\.facebook\.com/groups/[A-Za-z0-9.]{3,100}/?$#';
    }

    /**
     * @param  array<string, mixed>  $session  a value of FacebookWebSession::load()
     * @return PublishResult|null null = rejected definitively (nothing was posted), the script may take over
     *
     * @throws PublishAborted when the outcome is ambiguous
     */
    private function viaHttp(array $session, string $body, string $audience): ?PublishResult
    {
        try {
            // * The user's own Cookie plus the two GraphQL client headers the web app itself sends with this call (`x-fb-lsd` repeats the
            // * form's lsd token, `x-fb-friendly-name` names the mutation). No User-Agent or other browser header is set or imitated.
            $form = $this->session->render($session, $body, $audience);
            $headers = ['Cookie' => $session['cookie_header'], 'X-FB-LSD' => (string) ($form['lsd'] ?? $session['lsd'])];

            if (is_string($form['fb_api_req_friendly_name'] ?? null) && $form['fb_api_req_friendly_name'] !== '') {
                $headers['X-FB-Friendly-Name'] = $form['fb_api_req_friendly_name'];
            }

            $response = Http::timeout((int) config('posting.http_timeout_seconds'))
                ->connectTimeout((int) config('posting.http_connect_timeout_seconds'))
                ->withHeaders($headers)
                ->asForm()
                ->post(FacebookWebSession::GRAPHQL_URL, $form);
        } catch (ConnectionException) {
            throw $this->ambiguous('Hết thời gian chờ Facebook cá nhân, bài có thể đã được đăng.');
        }

        $outcome = $this->session->classify($response->status(), $response->body());

        if ($outcome['kind'] === 'rejected') {
            // * Only the status and the size of the reply: enough to tell why the direct call is refused, nothing from the body.
            Log::info('Facebook personal direct call rejected.', ['status' => $response->status(), 'bytes' => strlen($response->body())]);

            return null;
        }

        if ($outcome['kind'] !== 'ok') {
            throw $this->ambiguous('Facebook phản hồi chưa rõ kết quả, bài có thể đã được đăng.');
        }

        Log::info('Facebook personal post published.', ['via' => 'http']);

        $id = $outcome['post_id'];

        return PublishResult::published($id, ctype_digit($id) ? 'https://www.facebook.com/'.$id : null);
    }

    // * An ambiguous request may have posted, so it counts toward the hourly limit like an `unknown` result.
    private function ambiguous(string $message): PublishAborted
    {
        RateLimiter::hit(self::RATE_KEY, 3600);

        return PublishAborted::unknown($message);
    }
}
