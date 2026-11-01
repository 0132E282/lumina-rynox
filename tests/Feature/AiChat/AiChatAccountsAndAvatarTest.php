<?php

declare(strict_types=1);

namespace Tests\Feature\AiChat;

use App\Models\Admin;
use App\Models\AiChatSetting;
use App\Models\Integration;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AssistantAvatarStore;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Spatie\Permission\Models\Permission;
use Tests\Feature\Ai\AiTestCase;

class AiChatAccountsAndAvatarTest extends AiTestCase
{
    private function image(string $extension, int $width = 300, int $height = 200): UploadedFile
    {
        $canvas = imagecreatetruecolor($width, $height);
        ob_start();
        match ($extension) {
            'jpg' => imagejpeg($canvas),
            'gif' => imagegif($canvas),
            default => imagepng($canvas),
        };

        return UploadedFile::fake()->createWithContent("avatar.{$extension}", (string) ob_get_clean());
    }

    private function userWith(string ...$permissions): Admin
    {
        $user = Admin::factory()->create(['system_admin' => false]);

        foreach ($permissions as $permission) {
            $user->givePermissionTo(Permission::findOrCreate($permission, 'web'));
        }

        return $user->fresh();
    }

    private function upload(Admin $user, UploadedFile $file): TestResponse
    {
        return $this->actingAs($user)->post(route('ai-chat.settings.avatar.upload'), ['avatar' => $file], ['Accept' => 'application/json']);
    }

    public function test_a_valid_image_is_stored_privately_resized_and_served_with_safe_headers(): void
    {
        Storage::fake('local');
        $me = $this->admin();

        $response = $this->upload($me, $this->image('jpg', 600, 300))->assertOk();

        $path = (string) AiChatSetting::query()->where('user_id', $me->id)->value('avatar_path');
        $this->assertMatchesRegularExpression(AssistantAvatarStore::PATH_PATTERN, $path);
        $this->assertStringStartsWith("ai-chat/avatars/{$me->id}/", $path);
        Storage::disk('local')->assertExists($path);
        $this->assertStringContainsString('/ai-chat/settings/avatar?v=', (string) $response->json('settings.avatar_url'));
        $this->assertStringNotContainsString('ai-chat/avatars/', (string) $response->getContent());

        $size = getimagesizefromstring(Storage::disk('local')->get($path));
        $this->assertSame($size[0], $size[1]);
        $this->assertLessThanOrEqual(256, $size[0]);

        $served = $this->actingAs($me)->get(route('ai-chat.settings.avatar'))->assertOk();
        $served->assertHeader('X-Content-Type-Options', 'nosniff');
        $served->assertHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        $this->assertStringContainsString('private', (string) $served->headers->get('Cache-Control'));
        $this->assertContains($served->headers->get('Content-Type'), ['image/webp', 'image/png']);
    }

    public function test_svg_scripts_disguised_as_images_text_and_oversized_files_are_rejected(): void
    {
        Storage::fake('local');
        $me = $this->admin();
        $bad = [
            UploadedFile::fake()->createWithContent('a.png', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
            UploadedFile::fake()->createWithContent('a.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
            UploadedFile::fake()->createWithContent('a.png', '<?php echo 1;'),
            UploadedFile::fake()->createWithContent('a.png', 'just text'),
            UploadedFile::fake()->create('big.png', 3000),
            $this->image('png', 2049, 10),
        ];

        foreach ($bad as $index => $file) {
            $this->upload($me, $file)->assertStatus(422, "case {$index}");
        }

        $this->assertSame(0, AiChatSetting::query()->count());
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_another_user_never_gets_someone_elses_avatar(): void
    {
        Storage::fake('local');
        $me = $this->admin();
        $other = $this->admin();
        $this->upload($me, $this->image('png'))->assertOk();

        $this->actingAs($other)->get(route('ai-chat.settings.avatar'))->assertNotFound();
        $this->actingAs($other)->get('/')->assertInertia(fn ($page) => $page->where('settings.avatar_url', null));
    }

    public function test_replacing_and_removing_the_avatar_deletes_the_old_files(): void
    {
        Storage::fake('local');
        $me = $this->admin();

        $this->upload($me, $this->image('png'))->assertOk();
        $first = (string) AiChatSetting::query()->value('avatar_path');
        $this->upload($me, $this->image('png', 100, 100))->assertOk();
        $second = (string) AiChatSetting::query()->value('avatar_path');

        $this->assertNotSame($first, $second);
        Storage::disk('local')->assertMissing($first);
        Storage::disk('local')->assertExists($second);

        $this->actingAs($me)->deleteJson(route('ai-chat.settings.avatar.remove'))->assertOk()->assertJsonPath('settings.avatar_url', null);
        Storage::disk('local')->assertMissing($second);

        $this->upload($me, $this->image('png'))->assertOk();
        $third = (string) AiChatSetting::query()->value('avatar_path');
        $this->actingAs($me)->deleteJson(route('ai-chat.settings.destroy'))->assertOk();
        Storage::disk('local')->assertMissing($third);
    }

    public function test_avatar_routes_need_ai_use_and_the_page_never_exposes_disk_paths(): void
    {
        Storage::fake('local');
        $this->actingAs($this->userWith())->post(route('ai-chat.settings.avatar.upload'), [], ['Accept' => 'application/json'])->assertForbidden();

        $me = $this->admin();
        $this->upload($me, $this->image('png'))->assertOk();
        $page = $this->actingAs($me)->get('/');

        $this->assertStringNotContainsString('ai-chat\/avatars', (string) $page->getContent());
        $this->assertStringNotContainsString('ai-chat/avatars', html_entity_decode((string) $page->getContent()));
    }

    public function test_the_account_list_has_safe_fields_only_and_permission_flags(): void
    {
        $this->account(['name' => 'Chính']);
        $this->account(['name' => 'Tắt', 'enabled' => false, 'last_error' => 'boom '.self::SECRET]);

        $page = $this->actingAs($this->admin())->get('/');
        $page->assertInertia(fn ($inertia) => $inertia->has('aiAccountList.accounts', 2)->where('aiAccountList.can_update', true)->where('aiAccountList.can_view', true)
            ->has('aiAccountList.accounts.0', fn ($row) => $row->hasAll(['id', 'name', 'vendor_key', 'vendor', 'status', 'enabled', 'priority', 'purposes', 'models', 'model'])->missing('credentials')->missing('token')->missing('last_error')));
        $this->assertStringNotContainsString(self::SECRET, (string) $page->getContent());
        $this->assertStringNotContainsString('credentials', (string) $page->getContent());

        $this->actingAs($this->userWith('ai.use'))->get('/')->assertInertia(fn ($inertia) => $inertia->where('aiAccountList.can_update', false)->where('aiAccountList.can_view', false)->has('aiAccountList.accounts', 2));
    }

    public function test_toggling_an_account_still_needs_integrations_update(): void
    {
        $account = $this->account();
        $user = $this->userWith('ai.use', 'integrations.view');

        $this->actingAs($user)->post(route('integrations.ai.accounts.toggle', $account))->assertForbidden();
        $this->assertTrue($account->fresh()->enabled);
    }

    public function test_an_avatar_over_the_one_megabyte_limit_is_refused_with_a_clear_message_and_a_small_one_is_kept(): void
    {
        $me = $this->userWith('ai.use');

        // * The limit stays well under PHP's usual 2 MB post_max_size, so multipart overhead never reaches it.
        $this->actingAs($me)->post(route('ai-chat.settings.avatar.upload'), ['avatar' => UploadedFile::fake()->image('big.png', 64, 64)->size(1100)], ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.avatar.0', 'Ảnh không hợp lệ (chỉ nhận jpg, png, webp, gif tối đa 1 MB và 2048 px).');

        $this->actingAs($me)->post(route('ai-chat.settings.avatar.upload'), ['avatar' => UploadedFile::fake()->image('small.png', 512, 512)], ['Accept' => 'application/json'])
            ->assertOk();
    }

    /** @param array<string, mixed> $purposeAccounts */
    private function saveChoices(array $purposeAccounts): TestResponse
    {
        return $this->actingAs($this->admin())->put(route('integrations.ai.settings'), ['purpose_accounts' => $purposeAccounts]);
    }

    /** @return array<string, mixed> */
    private function storedChoices(): array
    {
        return Integration::query()->where('provider', 'ai')->firstOrFail()->settings['fields']['purpose_accounts'];
    }

    public function test_an_ordered_list_per_purpose_is_saved_without_wiping_the_report_setting(): void
    {
        $first = $this->account(['status' => 'connected']);
        $second = $this->account(['name' => 'Second', 'status' => 'connected']);
        Integration::query()->create(['provider' => 'ai', 'status' => Integration::STATUS_CONNECTED, 'settings' => ['fields' => ['report_conversation_id' => 'keep-me']]]);

        $this->saveChoices(['ask' => [['account_id' => $second->id, 'model' => 'claude-opus-4-5'], ['account_id' => $first->id, 'model' => null]], 'post_draft' => null, 'report' => []])
            ->assertSessionHasNoErrors();

        $this->assertSame(['ask' => [['account_id' => $second->id, 'model' => 'claude-opus-4-5'], ['account_id' => $first->id, 'model' => null]]], $this->storedChoices());
        $this->assertSame('keep-me', Integration::query()->where('provider', 'ai')->firstOrFail()->settings['fields']['report_conversation_id']);
        $this->actingAs($this->admin())->get('/')->assertInertia(fn ($page) => $page
            ->where('aiAccountList.purpose_accounts.ask.0.account_id', $second->id)
            ->where('aiAccountList.purpose_accounts.ask.0.model', 'claude-opus-4-5')
            ->where('aiAccountList.purpose_accounts.ask.1.account_id', $first->id)
            ->has('aiAccountList.accounts.0.models')
            ->missing('aiAccountList.accounts.0.credentials'));
    }

    public function test_purpose_choices_are_validated(): void
    {
        $account = $this->account(['status' => 'connected']);
        $other = $this->account(['name' => 'Other', 'status' => 'connected']);
        $offline = $this->account(['name' => 'Offline', 'status' => 'error']);
        $entry = ['account_id' => $account->id, 'model' => null];

        $this->saveChoices(['hack' => [$entry]])->assertSessionHasErrors('purpose_accounts');
        $this->saveChoices(['ask' => [['account_id' => 9999, 'model' => null]]])->assertSessionHasErrors('purpose_accounts.ask.0.account_id');
        $this->saveChoices(['ask' => [['account_id' => $offline->id, 'model' => null]]])->assertSessionHasErrors('purpose_accounts.ask.0.account_id');
        $this->saveChoices(['ask' => [['model' => 'claude-sonnet-4-5']]])->assertSessionHasErrors('purpose_accounts.ask.0.account_id');
        $this->saveChoices(['ask' => [$entry, $entry]])->assertSessionHasErrors('purpose_accounts.ask');
        $this->saveChoices(['ask' => [[...$entry, 'model' => 'm1'], [...$entry, 'model' => 'm1']]])->assertSessionHasErrors('purpose_accounts.ask');
        $this->saveChoices(['ask' => array_fill(0, 6, [...$entry, 'model' => 'x'])])->assertSessionHasErrors('purpose_accounts.ask');

        foreach (['--evil', '-x', 'a b', 'a;rm', str_repeat('a', 101)] as $bad) {
            $this->saveChoices(['ask' => [[...$entry, 'model' => $bad]]])->assertSessionHasErrors('purpose_accounts.ask.0.model');
        }

        // * The same account twice with different models is a different pair, and five entries are allowed.
        $this->saveChoices(['ask' => [[...$entry, 'model' => 'a'], [...$entry, 'model' => 'b'], ['account_id' => $other->id, 'model' => null]]])->assertSessionHasNoErrors();
        $this->saveChoices(['ask' => array_map(fn (int $n): array => [...$entry, 'model' => "m{$n}"], range(1, 5))])->assertSessionHasNoErrors();
        $this->assertCount(5, $this->storedChoices()['ask']);

        $this->actingAs($this->userWith('ai.use'))->put(route('integrations.ai.settings'), ['purpose_accounts' => ['ask' => [$entry]]])->assertForbidden();
    }

    public function test_older_stored_values_read_as_a_one_entry_list_and_older_requests_are_accepted(): void
    {
        $account = $this->account(['status' => 'connected']);
        $integration = Integration::query()->create(['provider' => 'ai', 'status' => Integration::STATUS_CONNECTED, 'settings' => ['fields' => ['purpose_accounts' => [
            'ask' => $account->id,
            'report' => "{$account->id}|claude-opus-4-5",
            'post_draft' => ['account_id' => $account->id, 'model' => 'claude-haiku-4-5'],
            'job_match' => 'garbage',
        ]]]]);

        $this->actingAs($this->admin())->get('/')->assertInertia(fn ($page) => $page
            ->where('aiAccountList.purpose_accounts.ask', [['account_id' => $account->id, 'model' => null]])
            ->where('aiAccountList.purpose_accounts.report', [['account_id' => $account->id, 'model' => 'claude-opus-4-5']])
            ->where('aiAccountList.purpose_accounts.post_draft', [['account_id' => $account->id, 'model' => 'claude-haiku-4-5']])
            ->missing('aiAccountList.purpose_accounts.job_match'));

        $this->saveChoices(['ask' => $account->id, 'report' => "{$account->id}|claude-opus-4-5"])->assertSessionHasNoErrors();
        $this->assertSame(['ask' => [['account_id' => $account->id, 'model' => null]], 'report' => [['account_id' => $account->id, 'model' => 'claude-opus-4-5']]], $this->storedChoices());
        $this->assertNotNull($integration);
    }

    public function test_the_listed_accounts_are_tried_in_order_with_their_own_model_and_then_the_rest(): void
    {
        $this->account(['name' => 'Unlisted', 'priority' => 1, 'credentials' => ['token' => 'token-unlisted']]);
        $first = $this->account(['name' => 'First', 'priority' => 50, 'model' => 'claude-haiku-4-5', 'credentials' => ['token' => 'token-first']]);
        $second = $this->account(['name' => 'Second', 'priority' => 60, 'credentials' => ['token' => 'token-second']]);
        Integration::query()->create(['provider' => 'ai', 'status' => Integration::STATUS_CONNECTED, 'settings' => ['fields' => ['purpose_accounts' => ['ask' => [
            ['account_id' => $first->id, 'model' => 'claude-opus-4-5'],
            ['account_id' => $second->id, 'model' => 'claude-sonnet-4-5'],
        ]]]]]);
        Http::fake(['api.anthropic.com/*' => Http::sequence()->push(['error' => 'x'], 500)->push(['error' => 'x'], 500)->push(['content' => [['text' => 'ok']]])]);

        $this->assertSame('ok', $this->app->make(AiAssistant::class)->complete('ask', 'system', 'prompt'));

        $calls = Http::recorded()->map(fn (array $pair): array => [$pair[0]->header('x-api-key')[0] ?? null, $pair[0]->data()['model'] ?? null])->values()->all();
        $this->assertSame([['token-first', 'claude-opus-4-5'], ['token-second', 'claude-sonnet-4-5']], array_slice($calls, 0, 2));
        $this->assertSame('token-unlisted', $calls[2][0]);
        $this->assertSame('claude-haiku-4-5', $first->fresh()->model);
    }

    public function test_a_failing_first_entry_hands_over_to_the_next_one_without_leaking_tokens(): void
    {
        $first = $this->account(['name' => 'First', 'credentials' => ['token' => 'token-first']]);
        $second = $this->account(['name' => 'Second', 'credentials' => ['token' => 'token-second']]);
        Integration::query()->create(['provider' => 'ai', 'status' => Integration::STATUS_CONNECTED, 'settings' => ['fields' => ['purpose_accounts' => ['ask' => [
            ['account_id' => $second->id, 'model' => null],
            ['account_id' => $first->id, 'model' => null],
        ]]]]]);
        Http::fake(['api.anthropic.com/*' => Http::sequence()->push(['error' => 'token-second'], 429)->push(['content' => [['text' => 'from first']]])]);

        $this->assertSame('from first', $this->app->make(AiAssistant::class)->complete('ask', 'system', 'prompt'));
        $this->assertSame(['token-second', 'token-first'], Http::recorded()->map(fn (array $pair): ?string => $pair[0]->header('x-api-key')[0] ?? null)->values()->all());
    }
}
