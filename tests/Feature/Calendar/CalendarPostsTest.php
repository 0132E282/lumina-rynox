<?php

declare(strict_types=1);

namespace Tests\Feature\Calendar;

use App\Models\Admin;
use App\Models\Post;
use App\Models\PostTarget;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

class CalendarPostsTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_scheduled_post_appears_on_its_scheduled_date(): void
    {
        // * 20:00 UTC on the 10th is already the 11th (03:00) in Asia/Ho_Chi_Minh.
        $post = $this->makePost('Sắp đăng', Post::STATUS_SCHEDULED, '2026-10-10 20:00:00', ['facebook']);

        $item = $this->posts()[0];

        $this->assertCount(1, $this->posts());
        $this->assertSame($post->id, $item['id']);
        $this->assertSame('2026-10-11', $item['date']);
        $this->assertSame('03:00', $item['time']);
        $this->assertSame('scheduled', $item['status']);
        $this->assertSame('Đã lên lịch', $item['status_label']);
        $this->assertSame([['provider' => 'facebook', 'status' => 'pending', 'status_label' => 'Chờ đăng']], $item['targets']);
    }

    public function test_a_published_post_uses_the_latest_target_published_date(): void
    {
        $post = $this->makePost('Đã đăng', Post::STATUS_PUBLISHED, '2026-10-05 02:00:00', ['facebook', 'linkedin']);
        $this->publish($post, 'facebook', '2026-10-06 02:00:00');
        $this->publish($post, 'linkedin', '2026-10-07 03:30:00');

        $item = $this->posts()[0];

        $this->assertSame('2026-10-07', $item['date']);
        $this->assertSame('10:30', $item['time']);
        $this->assertSame('published', $item['status']);
        $this->assertSame(['published', 'published'], array_column($item['targets'], 'status'));
    }

    public function test_a_failed_post_shows_the_failed_status_and_a_missing_title_falls_back_to_the_body(): void
    {
        $post = $this->makePost(null, Post::STATUS_FAILED, '2026-10-12 02:00:00', ['facebook'], str_repeat('x', 100));
        $post->targets()->update(['status' => PostTarget::STATUS_FAILED]);

        $item = $this->posts()[0];

        $this->assertSame('failed', $item['status']);
        $this->assertSame('Lỗi đăng', $item['status_label']);
        $this->assertSame('failed', $item['targets'][0]['status']);
        $this->assertSame(str_repeat('x', 60).'...', $item['title']);
    }

    public function test_posts_outside_the_grid_and_undated_drafts_are_excluded(): void
    {
        // * October 2026 grid: Mon 2026-09-28 .. Sun 2026-11-01.
        $this->makePost('Trước', Post::STATUS_SCHEDULED, '2026-09-27 10:00:00');
        $this->makePost('Sau', Post::STATUS_SCHEDULED, '2026-11-02 10:00:00');
        $this->makePost('Nháp', Post::STATUS_DRAFT, null);
        $edge = $this->makePost('Cuối lưới', Post::STATUS_SCHEDULED, '2026-11-01 10:00:00');
        // * Scheduled in the grid but published after it: the published day wins, so it is off-grid.
        $moved = $this->makePost('Đăng sau', Post::STATUS_PUBLISHED, '2026-10-10 10:00:00', ['facebook']);
        $this->publish($moved, 'facebook', '2026-11-05 10:00:00');

        $this->assertSame([$edge->id], array_column($this->posts(), 'id'));
    }

    public function test_a_user_without_posts_view_gets_no_posts(): void
    {
        $this->makePost('Kín', Post::STATUS_SCHEDULED, '2026-10-10 10:00:00');

        $admin = Admin::factory()->create(['system_admin' => false]);
        $admin->givePermissionTo(Permission::findOrCreate('events.view', 'web'));

        $props = $this->actingAs($admin)
            ->get(route('calendar.index', ['month' => '2026-10']))->assertOk()->viewData('page')['props'];

        $this->assertSame([], $props['posts']);
        $this->assertFalse($props['canViewPosts']);
    }

    public function test_the_query_count_stays_flat_as_posts_and_targets_grow(): void
    {
        $count = function (): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->actingAs(Admin::factory()->create(['system_admin' => true]))->get(route('calendar.index', ['month' => '2026-10']))->assertOk();

            return count(DB::getQueryLog());
        };

        $this->makePost('Một', Post::STATUS_SCHEDULED, '2026-10-10 10:00:00', ['facebook']);
        $before = $count();

        foreach (range(1, 5) as $index) {
            $post = $this->makePost("Bài {$index}", Post::STATUS_PUBLISHED, '2026-10-10 10:00:00', ['facebook', 'linkedin']);
            $this->publish($post, 'facebook', '2026-10-1'.$index.' 10:00:00');
        }

        $this->assertSame($before, $count());
    }

    /** @return list<array<string, mixed>> */
    private function posts(): array
    {
        return $this->actingAs(Admin::factory()->create(['system_admin' => true]))
            ->get(route('calendar.index', ['month' => '2026-10']))->assertOk()->viewData('page')['props']['posts'];
    }

    /** @param list<string> $providers */
    private function makePost(?string $title, string $status, ?string $scheduledAt, array $providers = [], string $body = 'Nội dung'): Post
    {
        $post = new Post(['title' => $title, 'body' => $body, 'scheduled_at' => $scheduledAt]);
        $post->forceFill(['status' => $status])->save();

        foreach ($providers as $provider) {
            $post->targets()->create(['provider' => $provider]);
        }

        return $post;
    }

    private function publish(Post $post, string $provider, string $publishedAt): void
    {
        $post->targets()->where('provider', $provider)->first()
            ->forceFill(['status' => PostTarget::STATUS_PUBLISHED, 'published_at' => $publishedAt])->save();
    }
}
