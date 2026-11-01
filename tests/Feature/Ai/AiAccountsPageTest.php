<?php

declare(strict_types=1);

namespace Tests\Feature\Ai;

use App\Models\Admin;
use App\Models\AiAccount;
use App\Models\Conversation;
use App\Models\Integration;
use App\Services\Ai\AiException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;

class AiAccountsPageTest extends AiTestCase
{
    /** @return array<string, mixed> */
    private function payload(array $overrides = []): array
    {
        return ['name' => 'Claude chính', 'vendor' => 'anthropic', 'auth_type' => 'api_token', 'token' => self::SECRET, 'model' => '', 'priority' => 10, 'purposes' => [], ...$overrides];
    }

    public function test_store_encrypts_the_token_and_the_page_only_shows_a_mask(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->post(route('integrations.ai.accounts.store'), $this->payload())->assertRedirect();

        $account = AiAccount::query()->firstOrFail();
        $this->assertSame(self::SECRET, $account->token());
        $this->assertStringNotContainsString(self::SECRET, (string) AiAccount::query()->toBase()->value('credentials'));
        $this->assertNull($account->purposes);

        $response = $this->get(route('integrations.show', 'ai'))->assertOk();
        $page = $response->viewData('page');

        $this->assertSame('integrations/ai', $page['component']);
        $this->assertSame('Claude chính', $page['props']['integration']['ai_accounts'][0]['name']);
        $this->assertSame(Integration::mask(self::SECRET), $page['props']['integration']['ai_accounts'][0]['token_mask']);
        $this->assertStringNotContainsString(self::SECRET, json_encode($page));
        $this->assertStringNotContainsString(self::SECRET, $response->getContent());
    }

    public function test_edit_keeps_the_token_when_blank_and_replaces_it_when_given(): void
    {
        $account = $this->account();
        $admin = $this->admin();

        $this->actingAs($admin)->put(route('integrations.ai.accounts.update', $account), $this->payload(['token' => '', 'name' => 'Renamed', 'purposes' => ['report']]))->assertRedirect();
        $this->assertSame(self::SECRET, $account->fresh()->token());
        $this->assertSame('Renamed', $account->fresh()->name);
        $this->assertSame(['report'], $account->fresh()->purposes);

        $this->put(route('integrations.ai.accounts.update', $account), $this->payload(['token' => 'new-token-0000']))->assertRedirect();
        $this->assertSame('new-token-0000', $account->fresh()->token());
    }

    public function test_deepseek_cannot_use_a_session_token_and_bad_input_is_rejected(): void
    {
        $this->actingAs($this->admin())->postJson(route('integrations.ai.accounts.store'), $this->payload(['vendor' => 'deepseek', 'auth_type' => 'session_token']))->assertStatus(422)->assertJsonValidationErrors('auth_type');
        $this->postJson(route('integrations.ai.accounts.store'), $this->payload(['model' => '--evil']))->assertStatus(422);
        $this->postJson(route('integrations.ai.accounts.store'), $this->payload(['token' => '']))->assertStatus(422);
        $this->assertSame(0, AiAccount::query()->count());
    }

    public function test_a_cli_session_account_can_be_saved_without_a_token_but_an_api_account_cannot(): void
    {
        $this->actingAs($this->admin())
            ->post(route('integrations.ai.accounts.store'), $this->payload(['auth_type' => 'session_token', 'token' => '']))
            ->assertRedirect();

        $account = AiAccount::query()->firstOrFail();
        $this->assertNull($account->token());
        $this->assertNull($account->maskedToken());

        $this->postJson(route('integrations.ai.accounts.store'), $this->payload(['auth_type' => 'api_token', 'token' => '']))
            ->assertStatus(422)
            ->assertJsonValidationErrors('token');
    }

    public function test_the_cli_login_button_starts_the_browser_login_and_the_status_reads_the_cli(): void
    {
        Process::fake([
            '*status*' => Process::result('{"loggedIn":true,"authMethod":"claude.ai"}'),
            '*' => Process::result(''),
        ]);
        $admin = $this->admin();

        $this->actingAs($admin)->postJson(route('integrations.ai.cli.login'), ['vendor' => 'anthropic'])->assertOk()->assertJson(['started' => true]);
        Process::assertRan(fn ($process): bool => str_contains(implode(' ', (array) $process->command), 'auth login'));

        $this->getJson(route('integrations.ai.cli.status', ['vendor' => 'anthropic']))->assertOk()->assertJson(['logged_in' => true]);
    }

    public function test_codex_login_uses_its_own_commands_and_other_vendors_are_refused(): void
    {
        Process::fake([
            '*status*' => Process::result('Logged in using ChatGPT'),
            '*' => Process::result(''),
        ]);
        $admin = $this->admin();

        $this->actingAs($admin)->postJson(route('integrations.ai.cli.login'), ['vendor' => 'openai'])->assertOk()->assertJson(['started' => true]);
        Process::assertRan(fn ($process): bool => str_contains(implode(' ', (array) $process->command), 'codex'));
        $this->getJson(route('integrations.ai.cli.status', ['vendor' => 'openai']))->assertOk()->assertJson(['logged_in' => true]);

        $this->postJson(route('integrations.ai.cli.login'), ['vendor' => 'google'])->assertStatus(422);
        $this->getJson(route('integrations.ai.cli.status'))->assertStatus(422);
    }

    public function test_the_cli_login_routes_need_integrations_update(): void
    {
        Process::fake();
        $viewer = Admin::factory()->create(['system_admin' => false]);

        $this->actingAs($viewer)->postJson(route('integrations.ai.cli.login'), ['vendor' => 'anthropic'])->assertForbidden();
        $this->getJson(route('integrations.ai.cli.status', ['vendor' => 'anthropic']))->assertForbidden();
        Process::assertNothingRan();
    }

    public function test_toggle_delete_and_test_work_and_need_integrations_update(): void
    {
        $account = $this->account();
        $viewer = Admin::factory()->create(['system_admin' => false]);

        $this->actingAs($viewer)->post(route('integrations.ai.accounts.toggle', $account))->assertForbidden();
        $this->delete(route('integrations.ai.accounts.destroy', $account))->assertForbidden();
        $this->post(route('integrations.ai.accounts.test', $account))->assertForbidden();

        $this->actingAs($this->admin())->post(route('integrations.ai.accounts.toggle', $account))->assertRedirect();
        $this->assertFalse($account->fresh()->enabled);

        Http::fake(['api.anthropic.com/*' => Http::response([], 401)]);
        $this->post(route('integrations.ai.accounts.test', $account))->assertRedirect();
        $this->assertSame(AiException::UNAUTHORIZED, $account->fresh()->last_error);

        $this->delete(route('integrations.ai.accounts.destroy', $account))->assertRedirect();
        $this->assertSame(0, AiAccount::query()->count());
    }

    public function test_the_report_conversation_is_saved_in_settings(): void
    {
        $conversation = Conversation::query()->create(['provider' => 'telegram', 'external_chat_id' => '1', 'type' => 'private', 'title' => 'A']);

        $this->actingAs($this->admin())->put(route('integrations.ai.settings'), ['report_conversation_id' => $conversation->id])->assertRedirect();
        $this->assertSame((string) $conversation->id, Integration::query()->where('provider', 'ai')->first()->settings['fields']['report_conversation_id']);

        $this->putJson(route('integrations.ai.settings'), ['report_conversation_id' => '0198a1b2-0000-7000-8000-000000000000'])->assertStatus(422);
    }
}
