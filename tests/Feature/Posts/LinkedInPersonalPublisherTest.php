<?php

declare(strict_types=1);

namespace Tests\Feature\Posts;

use App\Models\Integration;
use App\Models\Post;
use App\Models\PostTarget;
use App\Services\Integrations\IntegrationManager;
use App\Services\Posting\LinkedInPersonalPublisher;
use App\Services\Posting\PostPublishingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
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

// * Process and Http are always faked (stray ones fail the test): these tests never start node, open Chrome or touch LinkedIn.
// * The script itself decides between the in-browser API and the UI (and falls back after a definitive rejection); Laravel maps its JSON.
class LinkedInPersonalPublisherTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        RateLimiter::clear('linkedin-personal-post');
        Process::preventStrayProcesses();
        Http::preventStrayRequests();
        // * Never pick up a cookie file a developer saved on this machine.
        config(['posting.linkedin_personal.web_cookie' => null, 'posting.linkedin_personal.cookie_file' => '']);
    }

    public function test_an_api_in_browser_result_is_published_with_its_urn_and_the_path_is_logged(): void
    {
        $this->connect();
        Log::spy();
        Process::fake(['*' => Process::result('{"ok":true,"via":"browser-api","post_id":"urn:li:share:7001234567890","url":"https://www.linkedin.com/feed/update/urn:li:share:7001234567890/"}')]);

        $target = $this->scheduledTarget();

        $this->assertTrue(app(PostPublishingService::class)->publishPost($target->post));

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->status);
        $this->assertSame('urn:li:share:7001234567890', $target->external_post_id);
        $this->assertSame('https://www.linkedin.com/feed/update/urn:li:share:7001234567890/', $target->external_url);
        Log::shouldHaveReceived('info')->with('LinkedIn personal post published.', ['via' => 'browser-api'])->once();
        Http::assertNothingSent();
    }

    public function test_a_ui_result_uses_the_urn_of_the_post_link(): void
    {
        $this->connect();
        Log::spy();
        Process::fake(['*' => Process::result('{"ok":true,"via":"ui","url":"https://www.linkedin.com/feed/update/urn:li:activity:7009999999999/"}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->status);
        $this->assertSame('urn:li:activity:7009999999999', $target->external_post_id);
        Log::shouldHaveReceived('info')->with('LinkedIn personal post published.', ['via' => 'ui'])->once();
    }

    public function test_a_foreign_url_or_a_malformed_id_never_becomes_the_external_reference(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true,"via":"ui","post_id":"../x y","url":"https://evil.example/feed/update/urn:li:share:7001234567890/"}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->status);
        $this->assertStringStartsWith('local-', $target->external_post_id);
        $this->assertNull($target->external_url);
    }

    public function test_the_script_is_started_once_with_an_argv_array_in_the_project_directory(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true}')]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        Process::assertRanTimes(fn (PendingProcess $process): bool => $process->command === ['node', 'scripts/linkedin-post.mjs', 'post']
            && $process->path === base_path()
            && $process->timeout === 180, 1);
    }

    public function test_an_ambiguous_script_outcome_is_unknown_and_not_retried(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":false,"error":"unknown"}', exitCode: 1)]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_UNKNOWN, $target->status);
        $this->assertSame(LinkedInPersonalPublisher::UNCONFIRMED, $target->error);
        $this->assertSame(1, $target->attempts);
        Process::assertRanTimes(fn (): bool => true, 1);
    }

    public function test_a_process_timeout_is_unknown_and_counts_toward_the_limit(): void
    {
        $this->connect();
        config(['posting.providers.linkedin_personal.posts_per_hour' => 1]);
        Process::fake(['*' => function (): never {
            throw new ProcessTimedOutException(
                new SymfonyTimeout(new SymfonyProcess(['node']), SymfonyTimeout::TYPE_GENERAL),
                Process::result(''),
            );
        }]);

        $first = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($first->post);
        $second = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($second->post);

        $this->assertSame(PostTarget::STATUS_UNKNOWN, $first->refresh()->status);
        $this->assertSame('Đã đạt giới hạn số bài LinkedIn cá nhân mỗi giờ.', $second->refresh()->error);
    }

    /** @return array<string, array{0: string, 1: int}> */
    public static function unconfirmedOutputs(): array
    {
        return [
            'script reported timeout' => ['{"ok":false,"error":"timeout"}', 12],
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

    /** @return array<string, array{0: string, 1: int, 2: string}> */
    public static function definiteFailures(): array
    {
        return [
            'not logged in' => ['not_logged_in', 10, 'pnpm linkedin:login'],
            'composer' => ['composer_not_found', 11, 'khung đăng bài'],
            'audience' => ['audience_not_set', 15, 'đối tượng'],
            'checkpoint' => ['checkpoint', 13, 'xác minh'],
            'browser' => ['browser_unavailable', 16, 'Chrome'],
            'invalid input' => ['invalid_input', 14, 'không hợp lệ'],
            'image download' => ['image_download_failed', 17, 'Không tải được ảnh'],
            'image upload' => ['image_upload_failed', 18, 'Không đính kèm được ảnh'],
        ];
    }

    #[DataProvider('definiteFailures')]
    public function test_fixed_error_codes_are_failures_with_their_own_message(string $code, int $exitCode, string $message): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":false,"error":"'.$code.'"}', exitCode: $exitCode)]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_FAILED, $target->status);
        $this->assertStringContainsString($message, (string) $target->error);
    }

    public function test_a_failed_attempt_does_not_count_toward_the_hourly_limit(): void
    {
        $this->connect();
        config(['posting.providers.linkedin_personal.posts_per_hour' => 1]);
        Process::fake(['*' => Process::sequence()
            ->push(Process::result('{"ok":false,"error":"composer_not_found"}', exitCode: 11))
            ->push(Process::result('{"ok":true}'))]);

        $first = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($first->post);
        $second = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($second->post);

        $this->assertSame(PostTarget::STATUS_FAILED, $first->refresh()->status);
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $second->refresh()->status);
    }

    public function test_images_go_to_the_script_as_urls_on_stdin_and_never_over_http(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true,"via":"ui"}')]);

        $target = $this->scheduledTarget(['media' => [
            ['type' => 'image', 'url' => 'https://example.com/a.jpg'],
            ['type' => 'image', 'url' => 'https://example.com/b.png'],
        ]]);
        app(PostPublishingService::class)->publishPost($target->post);

        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->refresh()->status);
        Http::assertNothingSent();
        Process::assertRanTimes(function (PendingProcess $process): bool {
            return json_decode((string) $process->input, true) === [
                'text' => 'Xin chào',
                'audience' => 'public',
                'images' => ['https://example.com/a.jpg', 'https://example.com/b.png'],
            ];
        }, 1);
    }

    public function test_a_video_is_rejected_before_any_script(): void
    {
        $this->connect();
        Process::fake();

        $target = $this->scheduledTarget(['media' => [['type' => 'video', 'url' => 'https://example.com/a.mp4']]]);
        app(PostPublishingService::class)->publishPost($target->post);

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_FAILED, $target->status);
        $this->assertStringContainsString('video', (string) $target->error);
        Process::assertNothingRan();
        Http::assertNothingSent();
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function audiences(): array
    {
        return [
            'public' => ['public', 'public'],
            'connections' => ['connections', 'connections'],
            'a Facebook-only value falls back to the most private' => ['self', 'connections'],
            'unknown value falls back to the most private' => ['galaxy', 'connections'],
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

        Process::assertRan(fn (PendingProcess $process): bool => json_decode((string) $process->input, true) === ['text' => 'Xin chào', 'audience' => $expected]);
    }

    public function test_a_failure_message_and_the_logs_never_carry_script_output(): void
    {
        $this->connect();
        Log::spy();
        Process::fake(['*' => Process::result('{"ok":false,"error":"not_logged_in","detail":"li_at=secret-li-at; JSESSIONID=ajax:123"}', 'li_at=secret-cookie', 10)]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);

        $this->assertStringNotContainsString('secret', (string) $target->refresh()->error);
        $this->assertStringNotContainsString('li_at', (string) $target->error);
        Log::shouldNotHaveReceived('info');
    }

    public function test_the_connection_test_runs_session_mode(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true,"loggedIn":true,"template":true}')]);

        $result = app(IntegrationManager::class)->provider('linkedin_personal')->test();

        $this->assertTrue($result->ok);
        $this->assertStringContainsString('request trong Chrome', $result->message);
        Http::assertNothingSent();
        Process::assertRan(fn (PendingProcess $process): bool => $process->command === ['node', 'scripts/linkedin-post.mjs', 'session']);
    }

    public function test_the_connection_test_tells_when_there_is_no_template_yet(): void
    {
        $this->connect();
        Process::fake(['*' => Process::result('{"ok":true,"loggedIn":true,"template":false}')]);

        $result = app(IntegrationManager::class)->provider('linkedin_personal')->test();

        $this->assertTrue($result->ok);
        $this->assertStringContainsString('đầu tiên sẽ đăng bằng giao diện', $result->message);
    }

    public function test_the_connection_test_reports_a_missing_login_and_a_checkpoint(): void
    {
        $this->connect();
        Process::fake(['*' => Process::sequence()
            ->push(Process::result('{"ok":true,"loggedIn":false}'))
            ->push(Process::result('{"ok":false,"error":"checkpoint"}', exitCode: 13))]);

        $provider = app(IntegrationManager::class)->provider('linkedin_personal');
        $missing = $provider->test();
        $checkpoint = $provider->test();

        $this->assertFalse($missing->ok);
        $this->assertSame(LinkedInPersonalPublisher::NOT_LOGGED_IN, $missing->message);
        $this->assertFalse($checkpoint->ok);
        $this->assertStringContainsString('xác minh', $checkpoint->message);
    }

    public function test_the_integration_is_listed_as_unofficial_with_the_terms_warning(): void
    {
        $definition = app(IntegrationManager::class)->definition('linkedin_personal');

        $this->assertTrue($definition['unofficial']);
        $this->assertStringContainsString('hạn chế', $definition['description']);
    }

    private function connect(): void
    {
        Integration::query()->create([
            'provider' => 'linkedin_personal',
            'status' => Integration::STATUS_CONNECTED,
            'settings' => ['fields' => [], 'permissions' => ['publish']],
        ]);
    }

    /** @param array<string, mixed> $attributes */
    public function test_a_public_text_post_goes_over_http_with_the_cookie_when_one_is_configured(): void
    {
        $this->connect();
        config(['posting.linkedin_personal.web_cookie' => 'li_at=AQE-secret; JSESSIONID="ajax:123456"']);
        Http::fake(['www.linkedin.com/*' => Http::response('{"data":"urn:li:activity:7123456789012345678"}', 200)]);

        $target = $this->scheduledTarget(['body' => 'Xin chào LinkedIn']);

        $this->assertTrue(app(PostPublishingService::class)->publishPost($target->post));

        $target->refresh();
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->status);
        $this->assertSame('urn:li:activity:7123456789012345678', $target->external_post_id);
        Process::assertNothingRan();
        Http::assertSent(function ($request): bool {
            $body = $request->data();

            return str_starts_with($request->url(), 'https://www.linkedin.com/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.sharing.CreatePost')
                && $request->hasHeader('csrf-token', 'ajax:123456')
                && str_contains($request->header('Cookie')[0], 'li_at=AQE-secret')
                && $body['requestId'] === 'com.linkedin.sdui.requests.sharing.CreatePost'
                && $body['states'][0]['value']['text'] === 'Xin chào LinkedIn'
                && collect($body['states'])->firstWhere('key', 'ShareBoxselectedVisibilitySettingString')['value'] === 'Anyone';
        });
    }

    public function test_an_unreadable_http_answer_is_unknown_and_a_refusal_fails_and_halts(): void
    {
        $this->connect();
        config(['posting.linkedin_personal.web_cookie' => 'li_at=x; JSESSIONID="ajax:1"']);
        Http::fake(['www.linkedin.com/*' => Http::sequence()->push('{}', 200)->push('', 401)]);

        $first = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($first->post);
        $this->assertSame(PostTarget::STATUS_UNKNOWN, $first->refresh()->status);

        $second = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($second->post);
        $this->assertSame(PostTarget::STATUS_FAILED, $second->refresh()->status);
    }

    public function test_the_cookie_saved_by_the_login_script_is_used_when_env_is_empty(): void
    {
        $this->connect();
        $file = tempnam(sys_get_temp_dir(), 'li-cookie');
        file_put_contents($file, json_encode(['cookie' => 'li_at=fromfile; JSESSIONID="ajax:77"']));
        config(['posting.linkedin_personal.cookie_file' => $file]);
        Http::fake(['www.linkedin.com/*' => Http::response('{"data":"urn:li:activity:7123456789012345678"}', 200)]);

        $target = $this->scheduledTarget();
        app(PostPublishingService::class)->publishPost($target->post);
        @unlink($file);

        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->refresh()->status);
        Http::assertSent(fn ($request): bool => $request->hasHeader('csrf-token', 'ajax:77'));
    }

    public function test_the_connections_audience_and_images_still_use_the_script_even_with_a_cookie(): void
    {
        $this->connect();
        config(['posting.linkedin_personal.web_cookie' => 'li_at=x; JSESSIONID="ajax:1"']);
        Process::fake(['*' => Process::result('{"ok":true,"via":"ui","url":"https://www.linkedin.com/feed/update/urn:li:activity:7009999999999/"}')]);

        $target = $this->scheduledTarget();
        $target->update(['audience' => 'connections']);
        app(PostPublishingService::class)->publishPost($target->post);

        $this->assertSame(PostTarget::STATUS_PUBLISHED, $target->refresh()->status);
        Http::assertNothingSent();
    }

    private function scheduledTarget(array $attributes = []): PostTarget
    {
        $post = new Post(['title' => 'T', 'body' => 'Xin chào', ...$attributes]);
        $post->forceFill(['status' => Post::STATUS_SCHEDULED, 'scheduled_at' => now()->subMinute()])->save();

        return $post->targets()->create(['provider' => 'linkedin_personal', 'audience' => 'public']);
    }
}
