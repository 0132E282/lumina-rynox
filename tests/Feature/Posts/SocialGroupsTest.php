<?php

declare(strict_types=1);

namespace Tests\Feature\Posts;

use App\Models\Admin;
use App\Models\SocialGroup;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

// * Facebook is read over faked HTTP with a fake session file; Process strays are blocked, so node and Chrome are never started.
class SocialGroupsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Process::preventStrayProcesses();
        Http::preventStrayRequests();
        // * Never the real session file: tests write and delete this one.
        config(['posting.facebook_personal.session_file' => sys_get_temp_dir().'/pm-test-facebook-session-'.uniqid().'.json']);
        config(['inertia.ssr.enabled' => false]);
    }

    protected function tearDown(): void
    {
        File::delete((string) config('posting.facebook_personal.session_file'));

        parent::tearDown();
    }

    public function test_the_list_returns_only_the_groups_of_that_provider(): void
    {
        $this->group('facebook_personal', 'f1', 'Nhóm B');
        $this->group('facebook_personal', 'f2', 'Nhóm A');
        $this->group('linkedin_personal', 'l1', 'LinkedIn');

        $response = $this->actingAs($this->admin())->getJson(route('integrations.groups.index', 'facebook_personal'))->assertOk();

        $this->assertSame(['Nhóm A', 'Nhóm B'], array_column($response->json('groups'), 'name'));
    }

    public function test_the_management_page_lists_every_saved_group(): void
    {
        $this->group('facebook_personal', 'f1', 'Nhóm B');
        $this->group('linkedin_personal', 'l1', 'LinkedIn A');

        $this->actingAs($this->admin())->get(route('social-groups.index'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('social-groups/index')
                ->has('groups.data', 2)
                ->where('groups.data.0.provider', 'facebook_personal')
                ->where('groups.total', 2)
                ->where('canSync', true)
                ->has('providers', 2)
                ->where('providers.0.letter', 'F'));
    }

    public function test_the_management_page_pages_by_twenty(): void
    {
        foreach (range(1, 25) as $number) {
            $this->group('facebook_personal', 'g'.$number, sprintf('Nhóm %02d', $number));
        }
        $admin = $this->admin();

        $this->actingAs($admin)->get(route('social-groups.index'))
            ->assertInertia(fn (Assert $page) => $page->has('groups.data', 20)->where('groups.last_page', 2)->where('groups.total', 25));
        $this->actingAs($admin)->get(route('social-groups.index', ['page' => 2]))
            ->assertInertia(fn (Assert $page) => $page->has('groups.data', 5)->where('groups.current_page', 2));
    }

    public function test_the_management_page_filters_by_platform_and_searches_name_or_id(): void
    {
        $this->group('facebook_personal', 'f1', 'Nhóm F1');
        $this->group('facebook_personal', 'f2', 'Nhóm F2');
        $this->group('linkedin_personal', 'l1', 'Nhóm L1');
        $admin = $this->admin();

        $this->actingAs($admin)->get(route('social-groups.index', ['provider' => 'linkedin_personal']))
            ->assertInertia(fn (Assert $page) => $page
                ->has('groups.data', 1)
                ->where('groups.data.0.name', 'Nhóm L1')
                ->where('filters.provider', 'linkedin_personal')
                ->where('counts.all', 3)
                ->where('counts.facebook_personal', 2)
                ->where('counts.linkedin_personal', 1));

        SocialGroup::query()->where('external_id', 'f1')->update(['left_at' => now()]);
        $this->actingAs($admin)->get(route('social-groups.index', ['state' => 'left']))
            ->assertInertia(fn (Assert $page) => $page->has('groups.data', 1)->where('groups.data.0.external_id', 'f1')->where('filters.state', 'left'));
        $this->actingAs($admin)->get(route('social-groups.index', ['state' => 'active']))
            ->assertInertia(fn (Assert $page) => $page->has('groups.data', 2));

        $this->actingAs($admin)->get(route('social-groups.index', ['q' => 'F2']))
            ->assertInertia(fn (Assert $page) => $page->has('groups.data', 1)->where('groups.data.0.name', 'Nhóm F2')->where('filters.q', 'F2'));
        $this->actingAs($admin)->get(route('social-groups.index', ['q' => 'l1']))
            ->assertInertia(fn (Assert $page) => $page->has('groups.data', 1)->where('groups.data.0.external_id', 'l1'));
        // * `%` is a plain character in the search, not a wildcard.
        $this->actingAs($admin)->get(route('social-groups.index', ['q' => '%']))
            ->assertInertia(fn (Assert $page) => $page->has('groups.data', 0));

        // * An unknown platform is ignored, not an error: the list shows everything.
        $this->actingAs($admin)->get(route('social-groups.index', ['provider' => 'zalo']))
            ->assertInertia(fn (Assert $page) => $page->has('groups.data', 3)->where('filters.provider', null));
    }

    public function test_the_management_page_needs_integrations_view(): void
    {
        $limited = Admin::factory()->createOne(['system_admin' => false]);

        $this->actingAs($limited)->get(route('social-groups.index'))->assertForbidden();
    }

    public function test_guests_are_sent_to_login_from_the_management_page(): void
    {
        $this->get(route('social-groups.index'))->assertRedirect();
    }

    public function test_an_unknown_provider_is_404(): void
    {
        $this->actingAs($this->admin())->getJson(route('integrations.groups.index', 'zalo'))->assertNotFound();
        $this->postJson(route('integrations.groups.sync', 'instagram'))->assertNotFound();
    }

    public function test_sync_saves_the_groups_and_returns_the_list(): void
    {
        $this->fakeFacebook([[
            ['id' => '12345', 'name' => 'Laravel VN', 'url' => 'https://www.facebook.com/groups/12345'],
            ['id' => '99999', 'name' => 'Lạ', 'url' => 'https://evil.example/groups/99999'],
        ]]);

        $response = $this->actingAs($this->admin())->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertOk();

        $response->assertJsonPath('synced', 1)->assertJsonPath('groups.0.name', 'Laravel VN');
        $this->assertSame(1, SocialGroup::query()->where('provider', 'facebook_personal')->count());
        Http::assertSent(fn ($request): bool => $request->url() === 'https://www.facebook.com/api/graphql/' && str_contains($request->body(), 'doc_id=123456'));
        Http::assertSent(fn ($request): bool => str_contains($request->body(), 'fb_dtsg=fresh-dtsg') && str_contains($request->body(), 'lsd=fresh-lsd'));
        Process::assertNothingRan();
    }

    public function test_sync_follows_the_cursor_through_every_page(): void
    {
        $this->fakeFacebook([
            [['id' => 'grp1', 'name' => 'Một', 'url' => 'https://www.facebook.com/groups/grp1']],
            [['id' => 'grp2', 'name' => 'Hai', 'url' => 'https://www.facebook.com/groups/grp2']],
        ]);

        $this->actingAs($this->admin())->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertOk()->assertJsonPath('synced', 2);

        // * One GET renews the tokens, then one POST per page.
        Http::assertSentCount(3);
        Http::assertSent(fn ($request): bool => str_contains(urldecode($request->body()), '"cursor":"cursor-1"'));
    }

    public function test_sync_keeps_the_picture_only_from_the_platform_cdn_and_keeps_the_old_one_when_missing(): void
    {
        $url = 'https://www.facebook.com/groups/12345';
        $this->fakeFacebook([[
            ['id' => '12345', 'name' => 'Có ảnh', 'url' => $url, 'image' => 'https://scontent.xx.fbcdn.net/a.jpg'],
            ['id' => '67890', 'name' => 'Ảnh lạ', 'url' => 'https://www.facebook.com/groups/67890', 'image' => 'https://evil.example/a.jpg'],
        ]], [[
            ['id' => '12345', 'name' => 'Có ảnh', 'url' => $url, 'image' => null],
        ]]);
        $admin = $this->admin();

        $this->actingAs($admin)->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertOk();
        $this->assertSame('https://scontent.xx.fbcdn.net/a.jpg', SocialGroup::query()->where('external_id', '12345')->value('image_url'));
        $this->assertNull(SocialGroup::query()->where('external_id', '67890')->value('image_url'));

        $this->actingAs($admin)->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertOk();
        $this->assertSame('https://scontent.xx.fbcdn.net/a.jpg', SocialGroup::query()->where('external_id', '12345')->value('image_url'));
    }

    public function test_sync_keeps_names_whose_characters_contain_the_0x85_byte(): void
    {
        $this->fakeFacebook([[
            ['id' => '12345', 'name' => 'Nhóm Ņ ẅ', 'url' => 'https://www.facebook.com/groups/12345'],
        ]]);

        $this->actingAs($this->admin())->postJson(route('integrations.groups.sync', 'facebook_personal'))
            ->assertOk()
            ->assertJsonPath('groups.0.name', 'Nhóm Ņ ẅ');
    }

    public function test_a_group_the_next_sync_no_longer_finds_is_marked_left_and_comes_back_when_seen_again(): void
    {
        $this->group('facebook_personal', 'old1', 'Đã rời sau này');
        $this->group('linkedin_personal', 'li1', 'Của LinkedIn');
        $url = 'https://www.facebook.com/groups/';
        $this->fakeFacebook(
            [[['id' => 'new1', 'name' => 'Mới', 'url' => $url.'new1']]],
            [[]],
            [[['id' => 'old1', 'name' => 'Đã rời sau này', 'url' => $url.'old1']]],
        );
        $admin = $this->admin();

        $this->actingAs($admin)->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertOk();
        $this->assertNotNull(SocialGroup::query()->where('external_id', 'old1')->value('left_at'));
        $this->assertNull(SocialGroup::query()->where('external_id', 'new1')->value('left_at'));
        $this->assertNull(SocialGroup::query()->where('external_id', 'li1')->value('left_at'));

        // * An empty run marks nothing new and un-marks nothing.
        $this->actingAs($admin)->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertOk();
        $this->assertNull(SocialGroup::query()->where('external_id', 'new1')->value('left_at'));
        $this->assertNotNull(SocialGroup::query()->where('external_id', 'old1')->value('left_at'));

        $this->actingAs($admin)->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertOk();
        $this->assertNull(SocialGroup::query()->where('external_id', 'old1')->value('left_at'));
        $this->assertNotNull(SocialGroup::query()->where('external_id', 'new1')->value('left_at'));
    }

    public function test_a_left_group_is_not_offered_or_accepted_for_a_new_post(): void
    {
        config(['inertia.ssr.enabled' => false]);
        $this->group('facebook_personal', 'here', 'Còn tham gia');
        $this->group('facebook_personal', 'gone', 'Đã rời');
        SocialGroup::query()->where('external_id', 'gone')->update(['left_at' => now()]);
        $admin = $this->admin();

        $this->actingAs($admin)->get(route('posts.create'))
            ->assertInertia(fn (Assert $page) => $page->has('socialGroups', 1)->where('socialGroups.0.name', 'Còn tham gia'));

        $this->actingAs($admin)->post(route('posts.store'), [
            'action' => 'draft',
            'body' => 'x',
            'groups' => ['facebook_personal' => [SocialGroup::query()->where('external_id', 'gone')->value('id')]],
        ])->assertSessionHasErrors('groups.facebook_personal');
    }

    public function test_linkedin_runs_its_own_script(): void
    {
        Process::fake(['*' => Process::result(self::encode(['ok' => true, 'groups' => []]))]);

        $this->actingAs($this->admin())->postJson(route('integrations.groups.sync', 'linkedin_personal'))->assertOk()->assertJsonPath('synced', 0);

        Process::assertRan(fn ($process): bool => str_contains(implode(' ', (array) $process->command), 'linkedin-post.mjs'));
    }

    public function test_a_missing_session_becomes_a_clean_error_and_keeps_saved_groups(): void
    {
        $this->group('facebook_personal', 'f1', 'Giữ lại');

        $response = $this->actingAs($this->admin())->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertStatus(502);

        $this->assertStringContainsString('Chưa có phiên Facebook', $response->json('message'));
        $this->assertSame(1, SocialGroup::query()->count());
        Http::assertNothingSent();
    }

    public function test_a_rejected_session_becomes_a_clean_error_and_keeps_saved_groups(): void
    {
        $this->group('facebook_personal', 'f1', 'Giữ lại');
        $this->writeSession();
        Http::fake(['*' => Http::response('for (;;);{"error":1357054,"errorSummary":"x"}')]);

        $response = $this->actingAs($this->admin())->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertStatus(502);

        $this->assertStringContainsString('hết hạn', $response->json('message'));
        $this->assertSame(1, SocialGroup::query()->count());
    }

    public function test_sync_is_throttled_to_three_per_ten_minutes(): void
    {
        $this->fakeFacebook([[]], [[]], [[]]);
        $admin = $this->admin();

        for ($attempt = 0; $attempt < 3; $attempt++) {
            $this->actingAs($admin)->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertOk();
        }

        $this->actingAs($admin)->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertStatus(429);
    }

    public function test_it_needs_the_integration_permissions(): void
    {
        $limited = Admin::factory()->createOne(['system_admin' => false]);

        $this->actingAs($limited)->getJson(route('integrations.groups.index', 'facebook_personal'))->assertForbidden();
        $this->actingAs($limited)->postJson(route('integrations.groups.sync', 'facebook_personal'))->assertForbidden();
    }

    public function test_guests_cannot_reach_it(): void
    {
        $this->getJson(route('integrations.groups.index', 'facebook_personal'))->assertUnauthorized();
    }

    private function group(string $provider, string $externalId, string $name): void
    {
        SocialGroup::query()->create(['provider' => $provider, 'external_id' => $externalId, 'name' => $name, 'url' => 'https://www.facebook.com/groups/'.$externalId, 'synced_at' => now()]);
    }

    private function admin(): Admin
    {
        return Admin::factory()->createOne(['system_admin' => true]);
    }

    private function writeSession(): void
    {
        $path = (string) config('posting.facebook_personal.session_file');
        File::ensureDirectoryExists(dirname($path));
        File::put($path, self::encode([
            'user_id' => '100', 'fb_dtsg' => 'dtsg', 'lsd' => 'lsd', 'jazoest' => '2', 'cookie_header' => 'c_user=100',
            'groups_template' => ['params' => ['doc_id' => '123456', 'fb_api_req_friendly_name' => 'GroupsCometAllJoinedGroupsSectionPaginationQuery'], 'variables' => ['count' => 20]],
        ]));
    }

    /**
     * One run per argument; each run is a list of pages, each page a list of groups ({id, name, url, image?}). Every page but the last of a run has a next cursor.
     *
     * @param  list<list<array<string, mixed>>>  ...$runs
     */
    private function fakeFacebook(array ...$runs): void
    {
        $this->writeSession();
        $responses = [];

        foreach ($runs as $pages) {
            foreach ($pages as $number => $groups) {
                $more = $number < count($pages) - 1;
                $edges = array_map(fn (array $group): array => ['node' => ['id' => $group['id'], 'name' => $group['name'], 'url' => $group['url'], 'profile_picture' => ['uri' => $group['image'] ?? null]]], $groups);
                $responses[] = Http::response('for (;;);'.self::encode(['data' => ['viewer' => ['all_joined_groups' => ['tab_groups_list' => [
                    'edges' => $edges,
                    'page_info' => ['has_next_page' => $more, 'end_cursor' => $more ? 'cursor-'.($number + 1) : null],
                ]]]]]));
            }
        }

        Http::fake([
            'www.facebook.com/groups/joins*' => Http::response('x"DTSGInitialData",[],{"token":"fresh-dtsg"},1],["LSD",[],{"token":"fresh-lsd"},2]'),
            // * Scoped to the GraphQL URL: Laravel evaluates every matching stub, so a `*` sequence would also be spent by the joins page GET.
            'www.facebook.com/api/graphql*' => Http::sequence($responses)->whenEmpty(Http::response('for (;;);'.self::encode(['data' => ['viewer' => ['all_joined_groups' => ['tab_groups_list' => ['edges' => [], 'page_info' => ['has_next_page' => false, 'end_cursor' => null]]]]]])))]);
    }

    /** @param array<string, mixed> $payload */
    private static function encode(array $payload): string
    {
        return json_encode($payload, JSON_THROW_ON_ERROR);
    }
}
