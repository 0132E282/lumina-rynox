<?php

declare(strict_types=1);

namespace Tests\Feature\Posts;

use App\Models\Admin;
use App\Models\Integration;
use App\Models\Post;
use App\Models\PostTarget;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class PostManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_index_filters_by_exact_status_group_provider_and_search(): void
    {
        $this->makePost('Nháp 1', Post::STATUS_DRAFT);
        $this->makePost('Một phần', Post::STATUS_PARTIAL, ['linkedin']);
        $this->makePost('Lỡ lịch', Post::STATUS_MISSED, ['facebook']);
        $this->makePost('Giảm 50%_off', Post::STATUS_DRAFT, ['linkedin'], 'nội dung đặc biệt');

        $titles = fn (array $query): array => collect($this->actingAs($this->admin())->get(route('posts.index', $query))->assertOk()->viewData('page')['props']['posts']['data'])->pluck('title')->sort()->values()->all();

        $this->assertSame(['Một phần'], $titles(['state' => 'partial']));
        $this->assertSame(['Lỡ lịch'], $titles(['state' => 'missed']));
        // * The tab group `failed` still covers partial + missed (+ failed).
        $this->assertSame(['Lỡ lịch', 'Một phần'], $titles(['status' => 'failed']));
        $this->assertSame(['Lỡ lịch'], $titles(['state' => 'missed', 'status' => 'draft']));
        $this->assertSame(['Giảm 50%_off', 'Một phần'], $titles(['provider' => 'linkedin']));
        $this->assertSame(['Giảm 50%_off'], $titles(['q' => '50%_off']));
        $this->assertSame(['Giảm 50%_off'], $titles(['q' => 'đặc biệt']));
        // * `%` and `_` are literal: they must not match everything.
        $this->assertSame([], $titles(['q' => '%%%']));
        $this->assertSame(['Giảm 50%_off', 'Một phần'], $titles(['provider' => 'linkedin', 'status' => 'all']));

        $this->get(route('posts.index', ['state' => 'bogus']))->assertSessionHasErrors('state');
        $this->get(route('posts.index', ['provider' => 'bogus']))->assertSessionHasErrors('provider');
    }

    public function test_the_index_reports_the_active_state_filter(): void
    {
        $filters = $this->actingAs($this->admin())->get(route('posts.index', ['state' => 'missed']))->viewData('page')['props']['filters'];

        $this->assertSame('missed', $filters['state']);
        $this->assertSame('all', $filters['status']);
    }

    public function test_delete_needs_the_delete_permission_and_refuses_a_publishing_post(): void
    {
        $post = $this->makePost('Xoá được', Post::STATUS_FAILED, ['linkedin']);
        $publishing = $this->makePost('Đang đăng', Post::STATUS_PUBLISHING, ['linkedin']);

        $this->actingAs($this->limitedAdmin())->delete(route('posts.destroy', $post))->assertForbidden();
        $this->assertDatabaseHas('posts', ['id' => $post->id]);

        $this->actingAs($this->admin())->delete(route('posts.destroy', $publishing))->assertRedirect();
        $this->assertDatabaseHas('posts', ['id' => $publishing->id]);

        $this->delete(route('posts.destroy', $post))->assertRedirect();
        $this->assertDatabaseMissing('posts', ['id' => $post->id]);
        $this->assertDatabaseMissing('post_targets', ['post_id' => $post->id]);
        // * Deleting never reaches a platform.
        Http::assertNothingSent();
    }

    public function test_duplicate_makes_a_draft_copy_without_touching_or_sending_the_original(): void
    {
        Bus::fake();
        Http::fake();
        $original = new Post(['title' => 'Bài gốc', 'body' => 'Nội dung', 'media' => [['url' => 'https://example.com/a.jpg', 'type' => 'image']], 'scheduled_at' => now()->addDay()]);
        $original->forceFill(['status' => Post::STATUS_PUBLISHED])->save();
        $original->targets()->create(['provider' => 'linkedin']);
        $original->targets()->create(['provider' => 'facebook'])->forceFill(['status' => PostTarget::STATUS_PUBLISHED, 'external_post_id' => 'X1'])->save();

        $response = $this->actingAs($this->admin())->post(route('posts.duplicate', $original));

        $copy = Post::query()->where('id', '!=', $original->id)->sole();
        $response->assertRedirect(route('posts.edit', $copy));
        $this->assertSame('Bài gốc (bản sao)', $copy->title);
        $this->assertSame('Nội dung', $copy->body);
        $this->assertSame([['url' => 'https://example.com/a.jpg', 'type' => 'image']], $copy->media);
        $this->assertNull($copy->scheduled_at);
        $this->assertSame(Post::STATUS_DRAFT, $copy->status);
        $this->assertSame(['facebook', 'linkedin'], $copy->targets()->pluck('provider')->sort()->values()->all());
        $this->assertSame([PostTarget::STATUS_PENDING], $copy->targets()->pluck('status')->unique()->values()->all());
        $this->assertNull($copy->targets()->first()->external_post_id);

        $this->assertSame(Post::STATUS_PUBLISHED, $original->fresh()->status);
        $this->assertSame('Bài gốc', $original->fresh()->title);
        Bus::assertNothingDispatched();
        Http::assertNothingSent();
    }

    public function test_duplicate_keeps_a_missing_title_and_caps_a_long_one(): void
    {
        $untitled = $this->makePost(null, Post::STATUS_DRAFT);
        $long = $this->makePost(str_repeat('á', 255), Post::STATUS_DRAFT);
        $admin = $this->admin();

        $this->actingAs($admin)->post(route('posts.duplicate', $untitled))->assertRedirect();
        $this->post(route('posts.duplicate', $long))->assertRedirect();

        $this->assertNull(Post::query()->where('id', '>', $long->id)->orderBy('id')->first()->title);
        $copy = Post::query()->orderByDesc('id')->first();
        $this->assertLessThanOrEqual(255, mb_strlen($copy->title));
        $this->assertStringEndsWith(' (bản sao)', $copy->title);
    }

    public function test_duplicate_needs_the_create_permission_and_an_existing_post(): void
    {
        $post = $this->makePost('Gốc', Post::STATUS_DRAFT);

        $this->actingAs($this->limitedAdmin())->post(route('posts.duplicate', $post))->assertForbidden();
        $this->assertSame(1, Post::query()->count());

        $this->actingAs($this->admin())->post('/posts/9999/duplicate')->assertNotFound();
    }

    public function test_the_index_exposes_whether_the_user_can_create_for_the_duplicate_action(): void
    {
        $this->assertTrue($this->actingAs($this->admin())->get(route('posts.index'))->viewData('page')['props']['can']['create']);
    }

    public function test_post_targets_stay_unique_per_post_provider_and_group(): void
    {
        $post = $this->makePost('x', Post::STATUS_DRAFT, ['linkedin']);

        $this->assertSame(['linkedin'], $post->targets()->pluck('provider')->all());
        $this->assertTrue(collect(Schema::getIndexes('post_targets'))->contains(fn (array $index): bool => $index['unique'] && $index['columns'] === ['post_id', 'provider', 'social_group_id']));
        $this->assertFalse(collect(Schema::getIndexes('post_targets'))->contains(fn (array $index): bool => $index['unique'] && $index['columns'] === ['post_id', 'provider']));
    }

    public function test_the_audience_is_stored_per_target_and_defaults_to_self(): void
    {
        $this->connectPersonal();
        $admin = $this->admin();

        $this->actingAs($admin)->post(route('posts.store'), $this->payload(['facebook_personal'], ['facebook_personal' => 'public']))->assertSessionHasNoErrors();
        $this->post(route('posts.store'), $this->payload(['facebook_personal']))->assertSessionHasNoErrors();

        $this->assertSame(['public', 'self'], PostTarget::query()->orderBy('id')->pluck('audience')->all());
    }

    public function test_facebook_personal_accepts_images_but_rejects_video(): void
    {
        $this->connectPersonal();
        $this->actingAs($this->admin());

        $image = [['type' => 'image', 'url' => 'https://example.com/a.jpg']];
        $video = [['type' => 'video', 'url' => 'https://example.com/a.mp4']];

        $this->post(route('posts.store'), [...$this->payload(['facebook_personal']), 'media' => $image])->assertSessionHasNoErrors();
        $this->post(route('posts.store'), [...$this->payload(['facebook_personal']), 'media' => $video])->assertSessionHasErrors('media');
    }

    public function test_update_keeps_the_audience_chosen_at_creation(): void
    {
        $this->connectPersonal();
        $post = $this->makePost('x', Post::STATUS_DRAFT, ['facebook_personal']);

        $this->actingAs($this->admin())->put(route('posts.update', $post), $this->payload(['facebook_personal'], ['facebook_personal' => 'friends']))->assertSessionHasNoErrors();

        $this->assertSame('self', $post->targets()->sole()->audience);
        $props = $this->get(route('posts.edit', $post))->viewData('page')['props'];
        $this->assertSame(['facebook_personal' => 'self'], $props['post']['audiences']);
    }

    public function test_the_list_pages_by_twenty_posts(): void
    {
        foreach (range(1, 25) as $number) {
            $this->makePost('Bài '.$number, Post::STATUS_DRAFT, []);
        }
        $this->actingAs($this->admin());

        $first = $this->get(route('posts.index'))->viewData('page')['props']['posts'];
        $second = $this->get(route('posts.index', ['page' => 2]))->viewData('page')['props']['posts'];

        $this->assertCount(20, $first['data']);
        $this->assertSame(25, $first['total']);
        $this->assertCount(5, $second['data']);
    }

    public function test_a_sent_or_failed_post_can_be_saved_with_new_content_only(): void
    {
        $this->connectPersonal();
        $this->actingAs($this->admin());

        foreach ([Post::STATUS_PUBLISHED, Post::STATUS_FAILED, Post::STATUS_PARTIAL] as $status) {
            $post = $this->makePost('cũ', $status, ['facebook_personal']);

            $this->get(route('posts.edit', $post))->assertOk();
            $this->put(route('posts.update', $post), ['action' => 'save', 'title' => 'Mới', 'body' => 'nội dung mới'])->assertSessionHasNoErrors();

            $post->refresh();
            $this->assertSame('nội dung mới', $post->body);
            $this->assertSame($status, $post->status);
            $this->assertSame(1, $post->targets()->count());
        }
    }

    public function test_cancel_stops_every_waiting_or_running_target_of_a_post_being_sent(): void
    {
        $this->actingAs($this->admin());
        $sending = $this->makePost('đang gửi', Post::STATUS_PUBLISHING, ['facebook_personal', 'linkedin_personal', 'facebook']);
        $sending->targets()->where('provider', 'facebook_personal')->update(['status' => PostTarget::STATUS_PUBLISHING]);
        $sending->targets()->where('provider', 'facebook')->update(['status' => PostTarget::STATUS_PUBLISHED]);

        $this->post(route('posts.cancel', $sending))->assertRedirect();

        $this->assertSame(
            ['facebook' => 'published', 'facebook_personal' => 'failed', 'linkedin_personal' => 'failed'],
            $sending->targets()->pluck('status', 'provider')->sortKeys()->all(),
        );
        $this->assertSame(Post::STATUS_PARTIAL, $sending->refresh()->status);

        // * A post that is not being sent is left alone.
        $draft = $this->makePost('nháp', Post::STATUS_DRAFT, ['facebook_personal']);
        $this->post(route('posts.cancel', $draft))->assertRedirect();
        $this->assertSame('pending', $draft->targets()->firstOrFail()->status);
    }

    public function test_a_post_being_sent_cannot_be_edited_and_save_is_not_a_way_to_create(): void
    {
        $this->connectPersonal();
        $this->actingAs($this->admin());
        $sending = $this->makePost('đang gửi', Post::STATUS_PUBLISHING, ['facebook_personal']);

        $this->put(route('posts.update', $sending), ['action' => 'save', 'body' => 'sửa'])->assertForbidden();
        $this->post(route('posts.store'), ['action' => 'save', 'body' => 'tạo mới'])->assertForbidden();
        $this->assertNotSame('sửa', $sending->refresh()->body);
    }

    public function test_an_invalid_or_unsupported_audience_is_rejected(): void
    {
        $this->connectPersonal();
        $this->actingAs($this->admin());

        $this->post(route('posts.store'), $this->payload(['facebook_personal'], ['facebook_personal' => 'everyone']))->assertSessionHasErrors('audiences.facebook_personal');
        $this->post(route('posts.store'), $this->payload(['facebook_personal'], ['linkedin' => 'public']))->assertSessionHasErrors('audiences.linkedin');
        $this->post(route('posts.store'), $this->payload(['facebook_personal'], ['bogus' => 'self']))->assertSessionHasErrors('audiences.bogus');
        $this->assertSame(0, Post::query()->count());
    }

    public function test_each_provider_declares_its_own_audiences_and_default(): void
    {
        $this->connectPersonal();
        $this->connectPersonal('linkedin_personal');
        $this->actingAs($this->admin());

        $this->post(route('posts.store'), $this->payload(['facebook_personal', 'linkedin_personal'], ['linkedin_personal' => 'connections']))->assertSessionHasNoErrors();
        $this->post(route('posts.store'), $this->payload(['facebook_personal', 'linkedin_personal']))->assertSessionHasNoErrors();

        $this->assertSame(
            ['self', 'connections', 'self', 'public'],
            PostTarget::query()->orderBy('id')->pluck('audience')->all(),
        );

        $providers = $this->get(route('posts.create'))->viewData('page')['props']['providers'];
        $byKey = collect($providers)->keyBy('key');
        $this->assertSame(['self', 'friends', 'public'], array_column($byKey['facebook_personal']['audiences'], 'value'));
        $this->assertSame([['value' => 'public', 'label' => 'Mọi người'], ['value' => 'connections', 'label' => 'Kết nối']], $byKey['linkedin_personal']['audiences']);
        $this->assertSame([], $byKey['linkedin']['audiences']);
    }

    public function test_an_audience_of_another_provider_is_rejected(): void
    {
        $this->connectPersonal();
        $this->connectPersonal('linkedin_personal');
        $this->actingAs($this->admin());

        $this->post(route('posts.store'), $this->payload(['linkedin_personal'], ['linkedin_personal' => 'friends']))->assertSessionHasErrors('audiences.linkedin_personal');
        $this->post(route('posts.store'), $this->payload(['linkedin_personal'], ['linkedin_personal' => 'self']))->assertSessionHasErrors('audiences.linkedin_personal');
        $this->post(route('posts.store'), $this->payload(['facebook_personal'], ['facebook_personal' => 'connections']))->assertSessionHasErrors('audiences.facebook_personal');
        $this->assertSame(0, Post::query()->count());
    }

    public function test_linkedin_personal_accepts_images_but_rejects_video(): void
    {
        $this->connectPersonal('linkedin_personal');
        $this->actingAs($this->admin());

        $image = [['type' => 'image', 'url' => 'https://example.com/a.jpg']];
        $video = [['type' => 'video', 'url' => 'https://example.com/a.mp4']];

        $this->post(route('posts.store'), [...$this->payload(['linkedin_personal']), 'media' => $image])->assertSessionHasNoErrors();
        $this->post(route('posts.store'), [...$this->payload(['linkedin_personal']), 'media' => $video])->assertSessionHasErrors('media');
    }

    public function test_duplicate_copies_the_audience(): void
    {
        $original = $this->makePost('Gốc', Post::STATUS_DRAFT);
        $original->targets()->create(['provider' => 'facebook_personal', 'audience' => 'friends']);

        $this->actingAs($this->admin())->post(route('posts.duplicate', $original))->assertRedirect();

        $copy = Post::query()->where('id', '!=', $original->id)->sole();
        $this->assertSame('friends', $copy->targets()->sole()->audience);
    }

    private function connectPersonal(string $provider = 'facebook_personal'): void
    {
        Integration::query()->create([
            'provider' => $provider,
            'status' => Integration::STATUS_CONNECTED,
            'settings' => ['fields' => [], 'permissions' => ['publish']],
        ]);
    }

    /**
     * @param  list<string>  $targets
     * @param  array<string, string>  $audiences
     * @return array<string, mixed>
     */
    private function payload(array $targets, array $audiences = []): array
    {
        return ['action' => 'draft', 'body' => 'Nội dung', 'targets' => $targets, 'audiences' => $audiences];
    }

    /** @param list<string> $providers */
    private function makePost(?string $title, string $status, array $providers = [], string $body = 'Nội dung'): Post
    {
        $post = new Post(['title' => $title, 'body' => $body]);
        $post->forceFill(['status' => $status])->save();

        foreach ($providers as $provider) {
            $post->targets()->create(['provider' => $provider]);
        }

        return $post;
    }

    private function admin(): Admin
    {
        return Admin::factory()->create(['system_admin' => true]);
    }

    private function limitedAdmin(): Admin
    {
        return Admin::factory()->create(['system_admin' => false]);
    }
}
