<?php

declare(strict_types=1);

namespace Tests\Feature\Posts;

use App\Models\Integration;
use App\Models\Post;
use App\Models\PostTarget;
use App\Services\Integrations\IntegrationManager;
use App\Services\Posting\FacebookPersonalPublisher;
use App\Services\Posting\PostPublishingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\RateLimiter;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Process\Exception\ProcessTimedOutException as SymfonyTimeout;
use Symfony\Component\Process\Process as SymfonyProcess;
use Tests\TestCase;

// * Process and Http are always faked (stray ones fail the test): these tests never start node, open Chrome or touch Facebook.
class FacebookPersonalPublisherTest extends TestCase
{
    use RefreshDatabase;

    private const GRAPHQL = 'https://www.facebook.com/api/graphql/';

    private string $sessionFile;

    protected function setUp(): void
    {
        parent::setUp();
        RateLimiter::clear('facebook-personal-post');
        Process::preventStrayProcesses();
        Http::preventStrayRequests();

        // * Never the real storage/app/facebook-session.json.
        $this->sessionFile = sys_get_temp_dir().'/facebook-session-test-'.uniqid().'.json';
        config(['posting.facebook_personal.session_file' => $this->sessionFile]);
    }

    protected function tearDown(): void
    {
        if (is_file($this->sessionFile)) {
            unlink($this->sessionFile);
        }

        parent::tearDown();
    }

    /** @param array<string, mixed> $overrides */
    private function saveSession(array $overrides = []): void
    {
        file_put_contents($this->sessionFile, json_encode([
            'user_id' => '100001',
            'fb_dtsg' => 'DTSG1',
            'lsd' => 'LSD1',
            'jazoest' => '2999',
            'cookie_header' => 'c_user=100001; xs=secret-xs',
            'template' => [
                'params' => ['doc_id' => '123456', 'fb_api_req_friendly_name' => 'ComposerStoryCreateMutation'],
                'variables' => ['input' => [
                    'actor_id' => '{{user}}',
                    'message' => ['ranges' => [], 'text' => '{{text}}'],
                    'audience' => ['privacy' => ['base_state' => '{{privacy}}']],
                    'client_mutation_id' => '{{uuid:0}}',
                    'composer_session_id' => '{{uuid:0}}',
                    'other' => '{{uuid:1}}',
                ]],
            ],
            ...$overrides,
        ]));
    }

    public function test_tier_one_posts_with_plain_http_and_never_starts_the_browser(): void
    {
        $this->connect();
        $this->saveSession();
        Log::spy();
        Http::fake([self::GRAPHQL => Http::response('for (;;);{"data":{"story_create":{"post_id":"9001"}}}')]);
        Process::fake();

        $target = $this->scheduledTarget();
        $target->forceFill(['audience' => 'friends'])->save();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->status);
        $this->assertSame('9001', $target->external_post_id);
        $this->assertSame('https://www.facebook.com/9001', $target->external_url);
        Process::assertNothingRan();
        Log::shouldHaveReceived('info')->with('Facebook personal post published.', ['via' => 'http'])->once();
        Http::assertSentCount(1);
        Http::assertSent(function (Request $request): bool {
            $variables = json_decode($request['variables'], true)['input'];

            return $request['doc_id'] === '123456'
                && $request['fb_dtsg'] === 'DTSG1'
                && $request['av'] === '100001'
                && $variables['actor_id'] === '100001'
                && $variables['audience']['privacy']['base_state'] === 'FRIENDS'
                && $variables['message']['text'] === 'Xin chào'
                && $variables['client_mutation_id'] === $variables['composer_session_id']
                && $variables['client_mutation_id'] !== $variables['other']
                && preg_match('/^[0-9a-f-]{36}$/', $variables['other']) === 1
                && $request->header('Cookie') === ['c_user=100001; xs=secret-xs']
                && $request->header('X-FB-LSD') === ['LSD1']
                // * Nothing browser-like is imitated: Guzzle's own defaults (its honest User-Agent, length, host), the Cookie, the form type
                // * and the two GraphQL client headers of the web app (`x-fb-lsd`, and `x-fb-friendly-name` when the template names the mutation).
                && str_starts_with($request->header('User-Agent')[0] ?? '', 'GuzzleHttp/')
                && array_diff(array_map('strtolower', array_keys($request->headers())), ['cookie', 'content-type', 'content-length', 'user-agent', 'host', 'x-fb-lsd', 'x-fb-friendly-name']) === [];
        });
    }

    /** @return array<string, array{0: int, 1: string}> */
    public static function definitiveRejections(): array
    {
        return [
            'errors only' => [200, 'for (;;);{"errors":[{"message":"x","severity":"WARNING"}],"extensions":{"is_final":true}}'],
            'data null with errors' => [200, '{"data":null,"errors":[{"message":"x"}]}'],
            '400' => [400, 'blocked'],
            '403' => [403, 'x'],
            '429' => [429, 'x'],
        ];
    }

    #[DataProvider('definitiveRejections')]
    public function test_a_definitive_tier_one_rejection_falls_back_to_the_script_once(int $status, string $body): void
    {
        $this->connect();
        $this->saveSession();
        Http::fake([self::GRAPHQL => Http::response($body, $status)]);
        Process::fake(['*' => Process::result('{"ok":true,"via":"ui","url":"https://www.facebook.com/permalink.php?story_fbid=777"}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->status);
        $this->assertSame('777', $target->external_post_id);
        Http::assertSentCount(1);
        Process::assertRanTimes(fn (PendingProcess $process): bool => $process->command === ['node', 'scripts/facebook-post.mjs', 'post'], 1);
    }

    /** @return array<string, array{0: int, 1: string}> */
    public static function ambiguousReplies(): array
    {
        return [
            '5xx' => [503, 'x'],
            '500' => [500, 'c_user=100001; xs=secret-xs'],
            'data without a post id' => [200, '{"data":{}}'],
            'unreadable 200' => [200, '<html>login</html>'],
        ];
    }

    #[DataProvider('ambiguousReplies')]
    public function test_an_ambiguous_tier_one_reply_is_unknown_and_never_falls_through(int $status, string $body): void
    {
        $this->connect();
        $this->saveSession();
        Http::fake([self::GRAPHQL => Http::response($body, $status)]);
        Process::fake();

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_UNKNOWN, $target->status);
        $this->assertStringNotContainsString('secret', (string) $target->error);
        Process::assertNothingRan();
    }

    public function test_a_tier_one_timeout_is_unknown_and_never_falls_through(): void
    {
        $this->connect();
        $this->saveSession();
        Http::fake([self::GRAPHQL => fn () => throw new ConnectionException('cURL error 28 c_user=100001; xs=secret-xs')]);
        Process::fake();

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_UNKNOWN, $target->status);
        $this->assertStringNotContainsString('secret', (string) $target->error);
        Process::assertNothingRan();
    }

    public function test_an_ambiguous_tier_one_reply_counts_toward_the_hourly_limit(): void
    {
        $this->connect();
        $this->saveSession();
        config(['posting.providers.facebook_personal.posts_per_hour' => 1]);
        Http::fake([self::GRAPHQL => Http::response('x', 503)]);
        Process::fake();

        app(PostPublishingService::class)->publishPost($this->scheduledTarget()->post);
        $second = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($second->post);

        $this->assertSame('Đã đạt giới hạn số bài Facebook cá nhân mỗi giờ.', $second->refresh()->error);
        Http::assertSentCount(1);
    }

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function incompleteSessions(): array
    {
        return [
            'no template' => [['template' => null]],
            'template without the text anchor' => [['template' => ['params' => ['doc_id' => '123456'], 'variables' => ['privacy' => '{{privacy}}']]]],
            'no cookie' => [['cookie_header' => '']],
            'no token' => [['fb_dtsg' => '']],
        ];
    }

    /** @param array<string, mixed> $overrides */
    #[DataProvider('incompleteSessions')]
    public function test_an_incomplete_session_uses_only_the_script(array $overrides): void
    {
        $this->connect();
        $this->saveSession($overrides);
        Process::fake(['*' => Process::result('{"ok":true,"via":"ui"}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->refresh()->status);
        Http::assertNothingSent();
        Process::assertRanTimes(fn (): bool => true, 1);
    }

    public function test_without_a_session_file_only_the_script_is_used(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->refresh()->status);
        Http::assertNothingSent();
    }

    public function test_the_error_after_a_rejection_and_a_failed_script_holds_no_secret(): void
    {
        $this->connect();
        $this->saveSession();
        Http::fake([self::GRAPHQL => Http::response('c_user=100001; xs=secret-xs DTSG1', 400)]);
        Process::fake(['*' => Process::result('{"ok":false,"error":"not_logged_in"}', 'xs=secret-xs', 10)]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_FAILED, $target->status);
        $this->assertSame(FacebookPersonalPublisher::NOT_LOGGED_IN, $target->error);
    }

    public function test_an_api_result_is_published_with_its_post_id_and_the_path_is_logged(): void
    {
        $this->connect();
        Log::spy();
        Process::fake(['*' => Process::result('{"ok":true,"via":"browser-api","post_id":"9001","url":"https://www.facebook.com/9001"}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->status);
        $this->assertSame('9001', $target->external_post_id);
        $this->assertSame('https://www.facebook.com/9001', $target->external_url);
        Log::shouldHaveReceived('info')->with('Facebook personal post published.', ['via' => 'browser-api'])->once();
        Process::assertRanTimes(fn (PendingProcess $process): bool => $process->command === ['node', 'scripts/facebook-post.mjs', 'post'], 1);
    }

    public function test_a_post_id_without_a_url_is_used_as_the_external_id(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true,"via":"browser-api","post_id":"UzpfSTE="}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame('UzpfSTE=', $target->external_post_id);
        $this->assertNull($target->external_url);
    }

    public function test_a_malformed_post_id_never_becomes_the_external_id(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true,"via":"ui","post_id":"<script>x</script>"}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $this->assertStringStartsWith('local-', (string) $target->refresh()->external_post_id);
    }

    public function test_a_scheduled_post_is_published_to_the_personal_timeline(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true,"url":"https://www.facebook.com/permalink.php?story_fbid=9001&id=77"}'."\n")]);

        $target = $this->scheduledTarget();

        $this->assertTrue(app(PostPublishingService::class)->publishPost($target->post));

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->status);
        $this->assertSame('9001', $target->external_post_id);
        $this->assertSame('https://www.facebook.com/permalink.php?story_fbid=9001&id=77', $target->external_url);
        $this->assertSame(Post::STATUS_PUBLISHED, $target->post->refresh()->status);
    }

    public function test_the_script_is_started_with_an_argv_array_in_the_project_directory(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        Process::assertRan(fn (PendingProcess $process): bool => $process->command === ['node', 'scripts/facebook-post.mjs', 'post']
            && $process->path === base_path()
            && $process->timeout === 180);
    }

    public function test_an_ok_result_without_a_url_gets_a_local_marker_not_a_facebook_id(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->status);
        $this->assertStringStartsWith('local-', $target->external_post_id);
        $this->assertNull($target->external_url);
    }

    public function test_not_logged_in_is_a_failure_with_the_login_hint(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":false,"error":"not_logged_in"}', exitCode: 10)]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_FAILED, $target->status);
        $this->assertSame('Chưa đăng nhập Facebook trên máy này, chạy pnpm facebook:login', $target->error);
        $this->assertSame(1, $target->attempts);
    }

    public function test_a_checkpoint_fails_and_asks_the_human_to_solve_it(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":false,"error":"checkpoint"}', exitCode: 13)]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_FAILED, $target->status);
        $this->assertStringContainsString('xác minh', $target->error);
    }

    public function test_a_composer_that_was_not_found_fails(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":false,"error":"composer_not_found"}', exitCode: 11)]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $this->assertSame(PostTarget::STATUS_FAILED, $target->refresh()->status);
    }

    public function test_a_process_timeout_is_unknown_and_not_retried(): void
    {
        $this->connect();
        Process::fake(['*' => function (): never {
            throw new ProcessTimedOutException(
                new SymfonyTimeout(new SymfonyProcess(['node']), SymfonyTimeout::TYPE_GENERAL),
                Process::result(''),
            );
        }]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_UNKNOWN, $target->status);
        $this->assertSame(FacebookPersonalPublisher::UNCONFIRMED, $target->error);
        $this->assertSame(1, $target->attempts);
    }

    /** @return array<string, array{0: string, 1: int}> */
    public static function unconfirmedOutputs(): array
    {
        return [
            'script reported timeout' => ['{"ok":false,"error":"timeout"}', 12],
            'script reported unknown' => ['{"ok":false,"error":"unknown"}', 1],
            'no JSON at all' => ['Error: Cannot find package', 1],
            'an unlisted code' => ['{"ok":false,"error":"something_new"}', 1],
        ];
    }

    #[DataProvider('unconfirmedOutputs')]
    public function test_anything_unconfirmed_is_unknown_never_published(string $output, int $exitCode): void
    {
        $this->connect();
        Process::fake(['*' => Process::result($output, exitCode: $exitCode)]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_UNKNOWN, $target->status);
        $this->assertNull($target->external_post_id);
    }

    public function test_an_image_is_sent_to_the_script_with_the_urls_on_stdin_and_never_uses_http(): void
    {
        $this->connect();
        $this->saveSession();
        Process::fake(['*' => Process::result('{"ok":true,"url":"https://www.facebook.com/permalink.php?story_fbid=555"}')]);

        $target = $this->scheduledTarget(['media' => [
            ['type' => 'image', 'url' => 'https://example.com/a.jpg'],
            ['type' => 'image', 'url' => 'https://example.com/b.png'],
        ]]);
        app(PostPublishingService::class)->publishPost($target->post);

        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->refresh()->status);
        $this->assertSame('555', $target->external_post_id);
        Http::assertNothingSent();
        Process::assertRanTimes(function (PendingProcess $process): bool {
            $input = json_decode((string) $process->input, true);

            return $process->command === ['node', 'scripts/facebook-post.mjs', 'post']
                && $input === [
                    'text' => 'Xin chào',
                    'audience' => 'self',
                    'images' => ['https://example.com/a.jpg', 'https://example.com/b.png'],
                ];
        }, 1);
    }

    public function test_a_video_is_rejected_before_any_request_or_script(): void
    {
        $this->connect();
        $this->saveSession();
        Process::fake();

        $target = $this->scheduledTarget(['media' => [['type' => 'video', 'url' => 'https://example.com/a.mp4']]]);
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_FAILED, $target->status);
        $this->assertStringContainsString('video', (string) $target->error);
        Process::assertNothingRan();
        Http::assertNothingSent();
    }

    /** @return array<string, array{0: string, 1: int, 2: string}> */
    public static function imageFailureCodes(): array
    {
        return [
            'download' => ['image_download_failed', 17, 'Không tải được ảnh'],
            'upload' => ['image_upload_failed', 18, 'Không đính kèm được ảnh'],
        ];
    }

    #[DataProvider('imageFailureCodes')]
    public function test_image_error_codes_are_failures_with_their_own_message(string $code, int $exitCode, string $message): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":false,"error":"'.$code.'"}', exitCode: $exitCode)]);

        $target = $this->scheduledTarget(['media' => [['type' => 'image', 'url' => 'https://example.com/a.jpg']]]);
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_FAILED, $target->status);
        $this->assertStringContainsString($message, (string) $target->error);
        $this->assertStringNotContainsString('example.com', (string) $target->error);
    }

    public function test_the_hourly_limit_blocks_before_the_script_runs(): void
    {
        $this->connect();
        config(['posting.providers.facebook_personal.posts_per_hour' => 1]);
        Process::fake(['*' => Process::result('{"ok":true}')]);

        $first = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($first->post);
        $second = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($second->post);

        $this->assertSame('Đã đạt giới hạn số bài Facebook cá nhân mỗi giờ.', $second->refresh()->error);
        Process::assertRanTimes(fn (): bool => true, 1);
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function audiences(): array
    {
        return [
            'self' => ['self', 'self'],
            'friends' => ['friends', 'friends'],
            'public' => ['public', 'public'],
            'unknown value falls back to self' => ['galaxy', 'self'],
        ];
    }

    #[DataProvider('audiences')]
    public function test_the_target_audience_and_text_are_passed_on_stdin(string $audience, string $expected): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true}')]);

        $target = $this->scheduledTarget();
        $target->forceFill(['audience' => $audience])->save();
        app(PostPublishingService::class)->publishPost($target->post);

        Process::assertRan(function (PendingProcess $process) use ($expected): bool {
            $input = json_decode((string) $process->input, true);

            return $input === ['text' => 'Xin chào', 'audience' => $expected];
        });
    }

    public function test_a_failure_message_never_carries_script_output(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":false,"error":"not_logged_in","detail":"c_user=100001; xs=secret-xs"}', 'datr=secret-cookie', 10)]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $this->assertStringNotContainsString('secret', (string) $target->refresh()->error);
        $this->assertStringNotContainsString('c_user', (string) $target->error);
    }

    public function test_the_connection_test_runs_session_and_checks_the_saved_session_locally(): void
    {
        $this->connect();
        $this->saveSession();
        Process::fake(['*' => Process::result('{"ok":true,"loggedIn":true,"session":true}')]);

        $result = app(IntegrationManager::class)->provider('facebook_personal')->test();

        $this->assertTrue($result->ok);
        $this->assertStringContainsString('request HTTP từ máy chủ', $result->message);
        $this->assertStringNotContainsString('secret', $result->message);
        Http::assertNothingSent();
        Process::assertRan(fn (PendingProcess $process): bool => $process->command === ['node', 'scripts/facebook-post.mjs', 'session']);
    }

    public function test_the_connection_test_tells_when_there_is_no_template_yet(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true,"loggedIn":true,"session":true}')]);

        $result = app(IntegrationManager::class)->provider('facebook_personal')->test();

        $this->assertTrue($result->ok);
        $this->assertStringContainsString('đầu tiên sẽ đăng bằng trình duyệt', $result->message);
    }

    public function test_the_connection_test_reports_a_missing_login(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true,"loggedIn":false}')]);

        $result = app(IntegrationManager::class)->provider('facebook_personal')->test();

        $this->assertFalse($result->ok);
        $this->assertSame(FacebookPersonalPublisher::NOT_LOGGED_IN, $result->message);
    }

    private function connect(): void
    {
        Integration::query()->create([
            'provider' => 'facebook_personal',
            'status' => Integration::STATUS_CONNECTED,
            'settings' => ['fields' => [], 'permissions' => ['publish']],
        ]);
    }

    /** @param array<string, mixed> $attributes */
    private function scheduledTarget(array $attributes = []): PostTarget
    {
        $post = new Post(['title' => 'T', 'body' => 'Xin chào', ...$attributes]);
        $post->forceFill(['status' => Post::STATUS_SCHEDULED, 'scheduled_at' => now()->subMinute()])->save();

        return $post->targets()->create(['provider' => 'facebook_personal']);
    }
}
