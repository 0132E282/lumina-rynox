<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\Admin;
use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\ZaloAccount;
use App\Services\Chat\Telegram\ChatUnavailableException;
use App\Services\Chat\Zalo\BridgeSignature;
use App\Services\Chat\Zalo\ZaloSender;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class ZaloMultiAccountTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'bridge-secret';

    private Integration $integration;

    private ZaloAccount $first;

    private ZaloAccount $second;

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.zalo_bridge.secret' => self::SECRET, 'services.zalo_bridge.url' => 'http://sidecar.test']);

        $this->integration = Integration::query()->create(['provider' => 'zalo', 'status' => 'connected', 'settings' => ['risk_acknowledged' => true]]);
        $this->first = $this->account('1001', 'Shop A');
        $this->second = $this->account('2002', 'Shop B');
    }

    public function test_the_same_contact_gets_one_conversation_per_account(): void
    {
        $this->assertStored('1001', 'm1');
        $this->assertStored('2002', 'm2');

        $conversations = Conversation::query()->where('provider', 'zalo')->where('external_chat_id', 'u9')->orderBy('id')->get();

        $this->assertCount(2, $conversations);
        $this->assertSame([$this->first->id, $this->second->id], $conversations->pluck('zalo_account_id')->all());
        $this->assertSame([1, 1], $conversations->pluck('unread_count')->all());
    }

    public function test_a_redelivered_message_is_stored_once_and_goes_to_the_right_account(): void
    {
        $this->assertStored('1001', 'm1');
        $this->inbound('1001', 'm1')->assertOk()->assertJson(['stored' => false]);

        $this->assertSame(1, ChatMessage::query()->count());
        $this->assertSame($this->first->id, Conversation::query()->firstOrFail()->zalo_account_id);
    }

    public function test_an_inbound_without_account_key_is_accepted_only_when_exactly_one_account_exists(): void
    {
        $this->inbound(null, 'm1')->assertOk()->assertJson(['stored' => false]);

        $this->second->delete();
        $this->inbound(null, 'm2')->assertOk()->assertJson(['stored' => true]);
        $this->assertSame($this->first->id, Conversation::query()->firstOrFail()->zalo_account_id);
    }

    public function test_permissions_and_group_mode_are_checked_per_account(): void
    {
        $this->first->forceFill(['permissions' => ['reply']])->save();
        $this->second->forceFill(['group_mode' => 'all'])->save();

        $this->inbound('1001', 'm1')->assertJson(['stored' => false]);
        $this->inbound('2002', 'm2')->assertJson(['stored' => true]);

        // * Group without mention: dropped by default, stored by the account that answers in every group.
        $this->inbound('1001', 'g1', group: true)->assertJson(['stored' => false]);
        $this->second->forceFill(['group_mode' => null])->save();
        $this->inbound('2002', 'g2', group: true)->assertJson(['stored' => false]);
        $this->second->forceFill(['group_mode' => 'all'])->save();
        $this->inbound('2002', 'g3', group: true)->assertJson(['stored' => true]);
    }

    public function test_a_reply_is_sent_through_the_account_of_the_conversation(): void
    {
        $conversation = $this->conversationFor($this->second);
        $sentTo = [];
        Http::fake(function (Request $request) use (&$sentTo) {
            if (str_contains($request->url(), '/health')) {
                return Http::response(['state' => 'running', 'account' => null]);
            }

            $sentTo[] = json_decode($request->body(), true)['account'];

            return Http::response(['message_id' => 'z1']);
        });

        $message = app(ZaloSender::class)->send($conversation, 'xin chào', 'token-1', 'Staff');

        $this->assertSame(['2002'], $sentTo);
        $this->assertSame(ChatMessage::STATUS_SENT, $message->send_status);
        Http::assertSent(fn (Request $request): bool => str_contains($request->url(), '/health?account=2002'));
    }

    public function test_reply_and_proactive_scopes_and_rate_limit_are_per_account(): void
    {
        $this->first->forceFill(['permissions' => ['receive']])->save();
        $conversation = $this->conversationFor($this->first);

        try {
            app(ZaloSender::class)->send($conversation, 'x', 'a', null);
            $this->fail('reply is off for the first account');
        } catch (ChatUnavailableException $exception) {
            $this->assertStringContainsString('Trả lời', $exception->getMessage());
        }

        // * The second account still replies while the first is blocked.
        $other = $this->conversationFor($this->second);
        Http::fake(fn () => Http::response(['state' => 'running', 'message_id' => 'z2']));
        $this->assertSame(ChatMessage::STATUS_SENT, app(ZaloSender::class)->send($other, 'ok', 'b', null)->send_status);

        // * Exhausting the first account's budget does not limit the second.
        $this->first->forceFill(['permissions' => ['receive', 'reply']])->save();
        config(['services.zalo_bridge.send_per_minute' => 1]);
        RateLimiter::hit('zalo-send:'.$this->first->id, 60);
        $this->expectException(ChatUnavailableException::class);
        try {
            app(ZaloSender::class)->send($conversation, 'x', 'c', null);
        } finally {
            $this->assertSame(ChatMessage::STATUS_SENT, app(ZaloSender::class)->send($other, 'again', 'd', null)->send_status);
        }
    }

    public function test_proactive_send_needs_the_scope_of_that_account(): void
    {
        $conversation = Conversation::query()->create(['provider' => 'zalo', 'external_chat_id' => 'u9', 'type' => 'private', 'title' => 'Khách', 'integration_id' => $this->integration->id, 'zalo_account_id' => $this->first->id, 'account_scope' => $this->first->id]);
        Http::fake(fn () => Http::response(['state' => 'running', 'message_id' => 'z3']));

        $this->expectException(ChatUnavailableException::class);
        app(ZaloSender::class)->send($conversation, 'x', 't', null);
    }

    public function test_disconnecting_one_account_leaves_the_other_and_keeps_conversations(): void
    {
        $this->assertStored('1001', 'm1');
        Http::fake(['sidecar.test/logout' => Http::response(null, 204)]);

        $this->actingAs($this->admin())->delete(route('integrations.zalo.accounts.destroy', $this->first))->assertRedirect();

        $this->assertSame('disconnected', $this->first->fresh()->status);
        $this->assertNull($this->first->fresh()->credentials);
        $this->assertSame('connected', $this->second->fresh()->status);
        $this->assertSame('connected', $this->integration->fresh()->status);
        $this->assertSame(1, Conversation::query()->count());
        Http::assertSent(fn (Request $request): bool => str_ends_with($request->url(), '/logout') && json_decode($request->body(), true) === ['account' => '1001']);
        Http::assertSentCount(1);

        $this->delete(route('integrations.zalo.accounts.destroy', $this->second))->assertRedirect();
        $this->assertSame('disconnected', $this->integration->fresh()->status);
    }

    public function test_disconnected_account_does_not_accept_messages_or_get_a_restored_session(): void
    {
        $this->first->forceFill(['status' => 'disconnected', 'credentials' => null])->save();

        $this->inbound('1001', 'm1')->assertJson(['stored' => false]);
        $this->signedGet('/internal/zalo/session?account=1001')->assertNotFound();
        $this->signedGet('/internal/zalo/accounts')->assertOk()->assertExactJson(['accounts' => ['2002']]);
    }

    public function test_session_store_creates_an_account_and_a_relogin_updates_the_same_one(): void
    {
        $body = ['credentials' => ['cookie' => 'c', 'imei' => 'i', 'user_agent' => 'u'], 'account' => ['uid' => '3003', 'name' => 'Shop C']];
        $this->signedPost('/internal/zalo/session', $body)->assertNoContent();
        $this->signedPost('/internal/zalo/session', ['account' => ['uid' => '3003']] + $body)->assertNoContent();

        $this->assertSame(1, ZaloAccount::query()->where('account_key', '3003')->count());
        $this->assertSame('Shop C', ZaloAccount::query()->where('account_key', '3003')->firstOrFail()->name);
        $this->signedGet('/internal/zalo/session?account=3003')->assertOk()->assertJson(['credentials' => ['imei' => 'i']]);
    }

    public function test_status_callback_updates_only_the_reported_account(): void
    {
        $this->signedPost('/internal/zalo/status', ['account' => '1001', 'state' => 'session_lost', 'reason_code' => 'session_lost'])->assertNoContent();

        $this->assertSame('error', $this->first->fresh()->status);
        $this->assertSame('connected', $this->second->fresh()->status);
        $this->assertSame('connected', $this->integration->fresh()->status);
    }

    public function test_qr_start_applies_chosen_scopes_to_the_account_that_signs_in(): void
    {
        $this->integration->forceFill(['settings' => []])->save();
        Http::fake([
            'sidecar.test/qr/start' => Http::response(['login_id' => 'login-1']),
            'sidecar.test/qr/status*' => Http::response(['state' => 'logged_in', 'account_key' => '2002']),
        ]);

        $this->actingAs($this->admin())->postJson(route('integrations.zalo.qr.start'), [
            'risk_acknowledged' => true,
            'permissions' => ['receive', 'proactive'],
            'group_mode' => 'off',
        ])->assertOk()->assertJson(['login_id' => 'login-1']);

        $this->getJson(route('integrations.zalo.qr.status', ['login_id' => 'login-1']))
            ->assertOk()->assertJson(['state' => 'logged_in', 'account_name' => 'Shop B'])->assertJsonMissing(['account_key' => '2002']);

        $this->assertSame(['receive', 'proactive'], $this->second->fresh()->permissions);
        $this->assertSame('off', $this->second->fresh()->group_mode);
        $this->assertNull($this->first->fresh()->permissions);
        $this->assertTrue($this->integration->fresh()->settings['risk_acknowledged']);
        $this->assertNull(Cache::get('zalo:login:login-1'));
    }

    public function test_qr_start_does_not_log_out_running_accounts(): void
    {
        Http::fake(['sidecar.test/qr/start' => Http::response(['login_id' => 'login-2'])]);

        $this->actingAs($this->admin())->postJson(route('integrations.zalo.qr.start'), ['risk_acknowledged' => true])->assertOk();

        Http::assertNotSent(fn (Request $request): bool => str_ends_with($request->url(), '/logout') || str_contains($request->url(), '/health'));
    }

    public function test_contacts_sync_creates_conversations_for_that_account_only(): void
    {
        Http::fake(['sidecar.test/contacts*' => Http::response(['contacts' => [['thread_id' => 'u9', 'type' => 'user', 'name' => 'Khách'], ['thread_id' => 'g1', 'type' => 'group', 'name' => 'Nhóm']], 'truncated' => false])]);
        $this->assertStored('1001', 'm1');

        $this->actingAs($this->admin())->postJson(route('integrations.zalo.contacts.sync', $this->second))->assertOk()->assertJson(['friends' => 1, 'groups' => 1, 'created' => 2]);

        $this->assertSame(2, Conversation::query()->where('zalo_account_id', $this->second->id)->count());
        $this->assertSame(1, Conversation::query()->where('zalo_account_id', $this->first->id)->count());
        $this->assertNotNull($this->second->fresh()->contacts_synced_at);
        $this->assertNull($this->first->fresh()->contacts_synced_at);
        Http::assertSent(fn (Request $request): bool => str_contains($request->url(), '/contacts?account=2002'));
    }

    public function test_chat_page_names_the_account_of_each_zalo_conversation(): void
    {
        $this->assertStored('1001', 'm1');
        $this->assertStored('2002', 'm2');

        $response = $this->actingAs($this->admin())->get(route('chat.index'))->assertOk();
        $props = $response->viewData('page')['props'];

        $this->assertSame(2, $props['channels']['zalo']['account_count']);
        $this->assertSame(['Shop A', 'Shop B'], collect($props['conversations'])->pluck('account.name')->sort()->values()->all());
    }

    public function test_account_routes_need_integrations_update(): void
    {
        $viewer = Admin::factory()->create(['system_admin' => false]);

        $this->actingAs($viewer)->putJson(route('integrations.zalo.accounts.update', $this->first), ['permissions' => []])->assertForbidden();
        $this->delete(route('integrations.zalo.accounts.destroy', $this->first))->assertForbidden();
        $this->postJson(route('integrations.zalo.contacts.sync', $this->first))->assertForbidden();
        $this->assertSame('connected', $this->first->fresh()->status);
    }

    public function test_update_saves_scopes_and_group_mode_of_one_account(): void
    {
        $this->actingAs($this->admin())->put(route('integrations.zalo.accounts.update', $this->first), ['permissions' => ['receive', 'proactive'], 'group_mode' => 'all'])->assertRedirect();

        $this->assertSame(['receive', 'proactive'], $this->first->fresh()->permissions);
        $this->assertSame('all', $this->first->fresh()->group_mode);
        $this->assertNull($this->second->fresh()->permissions);

        $this->putJson(route('integrations.zalo.accounts.update', $this->first), ['permissions' => ['nope']])->assertStatus(422);
        $this->putJson(route('integrations.zalo.accounts.update', $this->first), ['permissions' => []])->assertStatus(302);
        $this->assertSame([], $this->first->fresh()->permissions);
    }

    public function test_page_exposes_accounts_without_secrets(): void
    {
        $response = $this->actingAs($this->admin())->get(route('integrations.show', 'zalo'))->assertOk();
        $page = $response->viewData('page');
        $integration = $page['props']['integration'];

        $this->assertSame('integrations/zalo', $page['component']);
        $this->assertSame(['Shop A', 'Shop B'], array_column($integration['accounts'], 'name'));
        $this->assertCount(3, $integration['account_permissions']);
        $this->assertCount(3, $integration['account_group_modes']);
        $this->assertStringNotContainsString('cookie', json_encode($page['props']));
        $this->assertStringNotContainsString('1001', json_encode($integration['accounts']));
    }

    private function account(string $key, string $name): ZaloAccount
    {
        return ZaloAccount::query()->create([
            'integration_id' => $this->integration->id,
            'account_key' => $key,
            'name' => $name,
            'credentials' => ['cookie' => 'c-'.$key, 'imei' => 'i-'.$key, 'user_agent' => 'ua'],
            'status' => 'connected',
        ]);
    }

    private function conversationFor(ZaloAccount $account): Conversation
    {
        $this->assertStored($account->account_key, 'seed-'.$account->account_key);

        return Conversation::query()->where('zalo_account_id', $account->id)->firstOrFail();
    }

    private function assertStored(string $accountKey, string $messageId): void
    {
        $this->inbound($accountKey, $messageId)->assertOk()->assertJson(['stored' => true]);
    }

    private function inbound(?string $accountKey, string $messageId, bool $group = false): TestResponse
    {
        return $this->signedPost('/internal/zalo/inbound', array_filter([
            'account' => $accountKey,
            'message_id' => $messageId,
            'thread_id' => $group ? 'g9' : 'u9',
            'thread_type' => $group ? 'group' : 'user',
            'thread_name' => $group ? 'Nhóm' : null,
            'sender_id' => 'u9',
            'sender_name' => 'Khách',
            'is_self' => false,
            'content_type' => 'text',
            'text' => 'xin chào',
            'mentions_self' => false,
            'sent_at_ms' => now()->getTimestampMs(),
        ], fn (mixed $value): bool => $value !== null));
    }

    /** @param array<string, mixed> $payload */
    private function signedPost(string $path, array $payload): TestResponse
    {
        $body = json_encode($payload, JSON_THROW_ON_ERROR);

        return $this->call('POST', $path, [], [], [], $this->signatureHeaders('POST', $path, $body), $body);
    }

    private function signedGet(string $path): TestResponse
    {
        return $this->call('GET', $path, [], [], [], $this->signatureHeaders('GET', $path, ''));
    }

    /** @return array<string, string> */
    private function signatureHeaders(string $method, string $path, string $body): array
    {
        $timestamp = time();

        return [
            'HTTP_X_BRIDGE_TIMESTAMP' => (string) $timestamp,
            'HTTP_X_BRIDGE_SIGNATURE' => BridgeSignature::sign(self::SECRET, $timestamp, $method, $path, $body),
            'HTTP_ACCEPT' => 'application/json',
            'CONTENT_TYPE' => 'application/json',
        ];
    }

    private function admin(): Admin
    {
        return Admin::factory()->create(['system_admin' => true]);
    }
}
