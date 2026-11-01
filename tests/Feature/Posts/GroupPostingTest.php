<?php

declare(strict_types=1);

namespace Tests\Feature\Posts;

use App\Models\Admin;
use App\Models\Integration;
use App\Models\Post;
use App\Models\PostTarget;
use App\Models\SocialGroup;
use App\Services\Posting\PostPublishingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Sleep;
use Tests\TestCase;

// * Bulk posting into saved groups. Process and Http are faked and stray ones fail the test: nothing starts node, opens Chrome or
// * touches Facebook/LinkedIn. Pauses are faked too, so no test sleeps.
class GroupPostingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        RateLimiter::clear('facebook-personal-post');
        RateLimiter::clear('linkedin-personal-post');
        Process::preventStrayProcesses();
        Http::preventStrayRequests();
        Sleep::fake();
        // * Never read the real saved Facebook session of this machine: the feed target must go to the faked script.
        config(['posting.facebook_personal.session_file' => sys_get_temp_dir().'/no-such-facebook-session-'.uniqid().'.json']);
        config(['inertia.ssr.enabled' => false]);
        config(['posting.group_posting.delay_min_seconds' => 10, 'posting.group_posting.delay_max_seconds' => 20]);
    }

    public function test_the_form_stores_one_target_per_ticked_group_next_to_the_feed_target_and_a_later_save_keeps_them(): void
    {
        $this->connect('facebook_personal');
        $first = $this->group('facebook_personal', 'grp1');
        $second = $this->group('facebook_personal', 'grp2');
        $this->actingAs($this->admin());

        $this->post(route('posts.store'), $this->payload(['targets' => ['facebook_personal'], 'groups' => ['facebook_personal' => [$first->id, $second->id]]]))->assertSessionHasNoErrors();

        $post = Post::query()->firstOrFail();
        $this->assertSame(3, $post->targets()->count());
        $this->assertSame(1, $post->targets()->whereNull('social_group_id')->count());
        $this->assertEqualsCanonicalizing([$first->id, $second->id], $post->targets()->whereNotNull('social_group_id')->pluck('social_group_id')->all());

        // * Platforms and groups are chosen once, at creation: a later save with other groups leaves the targets alone.
        $this->put(route('posts.update', $post), $this->payload(['groups' => ['facebook_personal' => [$second->id]]]))->assertSessionHasNoErrors();

        $this->assertSame(3, $post->targets()->count());
    }

    public function test_groups_alone_are_enough_and_the_edit_form_lists_them(): void
    {
        $this->connect('linkedin_personal');
        $group = $this->group('linkedin_personal', '1234567');
        $this->actingAs($this->admin());

        $this->post(route('posts.store'), $this->payload(['groups' => ['linkedin_personal' => [$group->id]]]))->assertSessionHasNoErrors();

        $post = Post::query()->firstOrFail();
        $props = $this->get(route('posts.edit', $post))->assertOk()->viewData('page')['props'];
        $this->assertSame([], $props['post']['targets']);
        $this->assertSame(['linkedin_personal' => [$group->id]], $props['post']['groups']);
        $this->assertSame([['id' => $group->id, 'provider' => 'linkedin_personal', 'name' => $group->name, 'image_url' => null]], $props['socialGroups']);
    }

    public function test_a_group_of_another_provider_an_unknown_one_or_too_many_are_refused(): void
    {
        $this->connect('facebook_personal');
        $foreign = $this->group('linkedin_personal', '1234567');
        $this->actingAs($this->admin());

        $this->post(route('posts.store'), $this->payload(['groups' => ['facebook_personal' => [$foreign->id]]]))->assertSessionHasErrors('groups.facebook_personal');
        $this->post(route('posts.store'), $this->payload(['groups' => ['facebook_personal' => [9999]]]))->assertSessionHasErrors('groups.facebook_personal');
        $this->post(route('posts.store'), $this->payload(['groups' => ['instagram' => [$foreign->id]]]))->assertSessionHasErrors('groups');

        config(['posting.providers.facebook_personal.posts_per_hour' => 1]);
        $ids = [$this->group('facebook_personal', 'gra1')->id, $this->group('facebook_personal', 'gra2')->id];
        $this->post(route('posts.store'), $this->payload(['groups' => ['facebook_personal' => $ids]]))->assertSessionHasErrors('groups.facebook_personal');
        $this->assertSame(0, Post::query()->count());
    }

    public function test_groups_are_posted_one_by_one_with_a_random_pause_and_the_feed_target_is_untouched(): void
    {
        $this->connect('facebook_personal');
        $post = $this->scheduledPost();
        $feed = $post->targets()->create(['provider' => 'facebook_personal', 'audience' => 'self']);
        $targets = $this->groupTargets($post, 'facebook_personal', ['grp1', 'grp2', 'grp3']);
        Process::fake(['*' => Process::sequence()
            ->push('{"ok":true,"via":"browser-api","post_id":"1","url":"https://www.facebook.com/1"}')
            ->push('{"ok":true,"via":"ui","url":"https://www.facebook.com/2"}')
            ->push('{"ok":true,"via":"ui","url":"https://www.facebook.com/3"}')
            ->push('{"ok":true,"via":"ui","url":"https://www.facebook.com/4"}')]);

        $this->assertTrue(app(PostPublishingService::class)->publishPost($post));

        $this->assertSame(['published', 'published', 'published'], array_map(fn (PostTarget $target): string => $target->refresh()->status, $targets));
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $feed->refresh()->status);
        $this->assertSame(Post::STATUS_PUBLISHED, $post->refresh()->status);

        $inputs = [];
        Process::assertRanTimes(function (PendingProcess $process) use (&$inputs): bool {
            $inputs[] = json_decode((string) $process->input, true);

            return true;
        }, 4);
        $this->assertArrayNotHasKey('group_url', $inputs[0]);
        $this->assertSame(['https://www.facebook.com/groups/grp1/', 'https://www.facebook.com/groups/grp2/', 'https://www.facebook.com/groups/grp3/'], array_column(array_slice($inputs, 1), 'group_url'));
        // * One pause before the 2nd and 3rd group only, never before the first one.
        Sleep::assertSleptTimes(2);
        Sleep::assertSlept(fn ($duration): bool => $duration->totalSeconds >= 10 && $duration->totalSeconds <= 20, 2);
    }

    public function test_a_checkpoint_stops_the_rest_of_the_batch_without_touching_the_site_again(): void
    {
        $this->connect('facebook_personal');
        $post = $this->scheduledPost();
        $targets = $this->groupTargets($post, 'facebook_personal', ['grp1', 'grp2', 'grp3']);
        Process::fake(['*' => Process::result('{"ok":false,"error":"checkpoint"}', exitCode: 13)]);

        app(PostPublishingService::class)->publishPost($post);

        Process::assertRanTimes(fn (): bool => true, 1);
        Sleep::assertNeverSlept();
        [$first, $second, $third] = array_map(fn (PostTarget $target): PostTarget => $target->refresh(), $targets);
        $this->assertSame(PostTarget::STATUS_FAILED, $first->status);
        $this->assertStringContainsString('xác minh', (string) $first->error);
        $this->assertSame([PostTarget::STATUS_FAILED, 0], [$second->status, $second->attempts]);
        $this->assertSame([PostTarget::STATUS_FAILED, 0], [$third->status, $third->attempts]);
        $this->assertStringContainsString('Đã dừng cả đợt', (string) $second->error);
        $this->assertSame(Post::STATUS_FAILED, $post->refresh()->status);
    }

    public function test_not_logged_in_also_stops_the_batch_but_only_for_that_provider(): void
    {
        $this->connect('facebook_personal');
        $this->connect('linkedin_personal');
        $post = $this->scheduledPost();
        $facebook = $this->groupTargets($post, 'facebook_personal', ['grp1', 'grp2']);
        $linkedin = $this->groupTargets($post, 'linkedin_personal', ['1234567']);
        Process::fake([
            '*facebook-post.mjs*' => Process::result('{"ok":false,"error":"not_logged_in"}', exitCode: 10),
            '*linkedin-post.mjs*' => Process::result('{"ok":true,"via":"ui","url":"https://www.linkedin.com/feed/update/urn:li:activity:7009999999999/"}'),
        ]);

        app(PostPublishingService::class)->publishPost($post);

        $this->assertSame([PostTarget::STATUS_FAILED, PostTarget::STATUS_FAILED], array_map(fn (PostTarget $target): string => $target->refresh()->status, $facebook));
        $this->assertSame(0, $facebook[1]->refresh()->attempts);
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $linkedin[0]->refresh()->status);
        $this->assertSame(Post::STATUS_PARTIAL, $post->refresh()->status);
    }

    public function test_an_unconfirmed_group_post_stays_unknown_is_not_retried_and_counts_toward_the_hourly_limit(): void
    {
        $this->connect('facebook_personal');
        $post = $this->scheduledPost();
        $targets = $this->groupTargets($post, 'facebook_personal', ['grp1', 'grp2']);
        Process::fake(['*' => Process::sequence()->push(Process::result('{"ok":false,"error":"unknown"}', exitCode: 1))->push('{"ok":true,"via":"ui","url":"https://www.facebook.com/2"}')]);

        app(PostPublishingService::class)->publishPost($post);

        $this->assertSame(PostTarget::STATUS_UNKNOWN, $targets[0]->refresh()->status);
        $this->assertSame(1, $targets[0]->attempts);
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $targets[1]->refresh()->status);
        Process::assertRanTimes(fn (): bool => true, 2);
        $this->assertSame(2, RateLimiter::attempts('facebook-personal-post'));
        $this->assertSame(Post::STATUS_PARTIAL, $post->refresh()->status);
    }

    public function test_the_hourly_limit_is_shared_with_the_provider_and_halts_the_batch(): void
    {
        $this->connect('facebook_personal');
        $limit = (int) config('posting.providers.facebook_personal.posts_per_hour');

        for ($hit = 0; $hit < $limit - 1; $hit++) {
            RateLimiter::hit('facebook-personal-post', 3600);
        }

        $post = $this->scheduledPost();
        $targets = $this->groupTargets($post, 'facebook_personal', ['grp1', 'grp2', 'grp3']);
        Process::fake(['*' => Process::result('{"ok":true,"via":"ui","url":"https://www.facebook.com/1"}')]);

        app(PostPublishingService::class)->publishPost($post);

        Process::assertRanTimes(fn (): bool => true, 1);
        $this->assertSame(PostTarget::STATUS_PUBLISHED, $targets[0]->refresh()->status);
        $this->assertSame(PostTarget::STATUS_FAILED, $targets[1]->refresh()->status);
        $this->assertSame(PostTarget::STATUS_FAILED, $targets[2]->refresh()->status);
        $this->assertSame(0, $targets[2]->attempts);
        $this->assertSame($limit, RateLimiter::attempts('facebook-personal-post'));
    }

    public function test_a_linkedin_group_target_sends_its_group_url_and_a_foreign_url_never_reaches_the_script(): void
    {
        $this->connect('linkedin_personal');
        $post = $this->scheduledPost();
        $targets = $this->groupTargets($post, 'linkedin_personal', ['1234567']);
        $bad = SocialGroup::query()->create(['provider' => 'linkedin_personal', 'external_id' => '7654321', 'name' => 'Lạ', 'url' => 'https://evil.example/groups/7654321/', 'synced_at' => now()]);
        $badTarget = $post->targets()->create(['provider' => 'linkedin_personal', 'social_group_id' => $bad->id, 'audience' => 'public']);
        Process::fake(['*' => Process::result('{"ok":true,"via":"ui","url":"https://www.linkedin.com/feed/update/urn:li:activity:7009999999999/"}')]);

        app(PostPublishingService::class)->publishPost($post);

        $this->assertSame(PostTarget::STATUS_PUBLISHED, $targets[0]->refresh()->status);
        $this->assertSame(PostTarget::STATUS_FAILED, $badTarget->refresh()->status);
        $inputs = [];
        Process::assertRanTimes(function (PendingProcess $process) use (&$inputs): bool {
            $inputs[] = json_decode((string) $process->input, true);

            return true;
        }, 1);
        $this->assertSame('https://www.linkedin.com/groups/1234567/', $inputs[0]['group_url']);
        $this->assertSame('Xin chào', $inputs[0]['text']);
    }

    public function test_duplicating_a_post_keeps_its_group_targets(): void
    {
        $post = $this->scheduledPost();
        $targets = $this->groupTargets($post, 'facebook_personal', ['grp1']);
        $this->actingAs($this->admin())->post(route('posts.duplicate', $post))->assertRedirect();

        $copy = Post::query()->whereKeyNot($post->id)->firstOrFail();
        $this->assertSame([$targets[0]->social_group_id], $copy->targets()->pluck('social_group_id')->all());
    }

    private function connect(string $provider): void
    {
        Integration::query()->create([
            'provider' => $provider,
            'status' => Integration::STATUS_CONNECTED,
            'settings' => ['fields' => [], 'permissions' => ['publish']],
        ]);
    }

    private function group(string $provider, string $externalId): SocialGroup
    {
        $host = $provider === 'facebook_personal' ? 'facebook' : 'linkedin';

        return SocialGroup::query()->create([
            'provider' => $provider,
            'external_id' => $externalId,
            'name' => 'Nhóm '.$externalId,
            'url' => "https://www.{$host}.com/groups/{$externalId}/",
            'synced_at' => now(),
        ]);
    }

    private function scheduledPost(): Post
    {
        $post = new Post(['title' => 'T', 'body' => 'Xin chào']);
        $post->forceFill(['status' => Post::STATUS_SCHEDULED, 'scheduled_at' => now()->subMinute()])->save();

        return $post;
    }

    /**
     * @param  list<string>  $externalIds
     * @return list<PostTarget>
     */
    private function groupTargets(Post $post, string $provider, array $externalIds): array
    {
        return array_map(fn (string $externalId): PostTarget => $post->targets()->create([
            'provider' => $provider,
            'social_group_id' => $this->group($provider, $externalId)->id,
            'audience' => $provider === 'facebook_personal' ? 'self' : 'public',
        ]), $externalIds);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function payload(array $overrides): array
    {
        return ['action' => 'draft', 'body' => 'Nội dung', ...$overrides];
    }

    private function admin(): Admin
    {
        return Admin::factory()->create(['system_admin' => true]);
    }
}
