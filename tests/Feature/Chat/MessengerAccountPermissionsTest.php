<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\Admin;
use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\Messenger\MessengerInbox;
use App\Services\Chat\Messenger\MessengerSender;
use App\Services\Chat\Telegram\ChatUnavailableException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use ReflectionMethod;
use Tests\TestCase;

class MessengerAccountPermissionsTest extends TestCase
{
    use RefreshDatabase;

    private Integration $integration;

    private MessengerAccount $first;

    private MessengerAccount $second;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.matrix.homeserver_url' => 'http://matrix.test',
            'services.matrix.user_id' => '@pm:pm.local',
            'services.matrix.access_token' => 'secret-token',
            'services.mautrix_meta.bot_user_id' => '@metabot:pm.local',
            'services.mautrix_meta.ghost_prefix' => '@meta_',
            'services.mautrix_meta.provisioning_url' => 'http://bridge.test',
            'services.mautrix_meta.provisioning_secret' => 'bridge-secret',
        ]);
        Storage::fake(MessengerInbox::ATTACHMENT_DISK);

        $this->integration = Integration::query()->create(['provider' => 'messenger', 'status' => 'connected']);
        $this->first = $this->account('111');
        $this->second = $this->account('222');
    }

    public function test_login_stores_the_chosen_permissions_on_the_new_account(): void
    {
        $this->fakeLoginBridge('333');

        $this->actingAs($this->admin())->postJson(route('integrations.messenger.login'), [
            'risk_acknowledged' => true,
            'cookies' => 'c_user=333; xs=abc',
            'permissions' => ['receive', 'proactive'],
        ])->assertOk();

        $account = MessengerAccount::query()->where('login_id', '333')->firstOrFail();
        $this->assertSame(['receive', 'proactive'], $account->permissions);
        $this->assertNull($this->first->fresh()->permissions);
    }

    public function test_login_without_permissions_keeps_defaults_and_an_unknown_scope_is_rejected(): void
    {
        $this->fakeLoginBridge('333');

        $this->actingAs($this->admin())->postJson(route('integrations.messenger.login'), [
            'risk_acknowledged' => true,
            'cookies' => 'c_user=333; xs=abc',
            'permissions' => ['receive', 'delete_everything'],
        ])->assertStatus(422)->assertJsonValidationErrors('permissions.1');
        $this->assertSame(0, MessengerAccount::query()->where('login_id', '333')->count());

        $this->postJson(route('integrations.messenger.login'), [
            'risk_acknowledged' => true,
            'cookies' => 'c_user=333; xs=abc',
        ])->assertOk();
        $account = MessengerAccount::query()->where('login_id', '333')->firstOrFail();
        $this->assertNull($account->permissions);
        $this->assertSame(['receive', 'reply'], $account->effectivePermissions());
    }

    public function test_update_changes_only_the_given_account_and_needs_update_permission(): void
    {
        $url = route('integrations.messenger.accounts.update', $this->first, false);

        $this->put($url, ['permissions' => ['receive']])->assertRedirect();
        $this->actingAs(Admin::factory()->create(['system_admin' => false]))->put($url, ['permissions' => ['receive']])->assertForbidden();
        $this->assertNull($this->first->fresh()->permissions);

        $this->actingAs($this->admin())->put($url, ['permissions' => ['reply', 'proactive']])->assertRedirect();
        $this->assertSame(['reply', 'proactive'], $this->first->fresh()->permissions);
        $this->assertNull($this->second->fresh()->permissions);

        $this->put($url, ['permissions' => []])->assertRedirect();
        $this->assertSame([], $this->first->fresh()->permissions);

        $this->put($url, ['permissions' => ['nope']])->assertSessionHasErrors('permissions.0');
        $this->put($url, [])->assertSessionHasErrors('permissions');
    }

    public function test_ingest_respects_receive_per_account(): void
    {
        $this->first->forceFill(['permissions' => ['reply']])->save();

        $this->ingest([
            '!a:pm.local' => $this->room('@meta_111:pm.local', '@meta_900:pm.local', 'cho An'),
            '!b:pm.local' => $this->room('@meta_222:pm.local', '@meta_901:pm.local', 'cho Bình'),
        ]);

        $this->assertSame(['cho Bình'], ChatMessage::query()->pluck('body')->all());
        $this->assertSame(2, Conversation::query()->count());
    }

    public function test_sender_respects_reply_and_proactive_of_the_conversation_account(): void
    {
        Http::fake([
            'bridge.test/*' => Http::response(['logins' => [['id' => '111', 'state' => ['state_event' => 'CONNECTED']], ['id' => '222', 'state' => ['state_event' => 'CONNECTED']]]]),
            'matrix.test/*' => Http::response(['event_id' => '$sent']),
        ]);
        $sender = app(MessengerSender::class);
        $withIncoming = $this->conversation($this->first, '!a:pm.local', true);
        $withoutIncoming = $this->conversation($this->second, '!b:pm.local', false);

        // * Defaults: reply on, proactive off, so a chat that never wrote to us cannot be started.
        $sender->ensureCanSend($withIncoming);
        $this->assertBlocked($sender, $withoutIncoming, 'gửi chủ động');

        $this->second->forceFill(['permissions' => ['reply', 'proactive']])->save();
        $sender->ensureCanSend($this->conversation($this->second, '!c:pm.local', false)->refresh());

        $this->first->forceFill(['permissions' => ['receive']])->save();
        $this->assertBlocked($sender, $withIncoming->refresh(), 'Trả lời tin nhắn');
    }

    public function test_backfill_copies_channel_scopes_to_accounts_without_their_own(): void
    {
        $this->integration->forceFill(['settings' => ['permissions' => ['receive', 'proactive']]])->save();
        $this->second->forceFill(['permissions' => ['reply']])->save();

        $migration = require database_path('migrations/2026_10_31_000004_add_permissions_to_messenger_accounts_table.php');
        (new ReflectionMethod($migration, 'backfill'))->invoke($migration);
        (new ReflectionMethod($migration, 'backfill'))->invoke($migration);

        $this->assertSame(['receive', 'proactive'], $this->first->fresh()->permissions);
        $this->assertSame(['reply'], $this->second->fresh()->permissions);
    }

    public function test_page_data_lists_permissions_and_last_check_per_account(): void
    {
        $this->first->forceFill(['permissions' => ['receive'], 'bridge_state_at' => now()])->save();

        $this->actingAs($this->admin())->get(route('integrations.show', ['provider' => 'messenger'], false))
            ->assertInertia(fn ($page) => $page->component('integrations/messenger')
                ->where('integration.accounts.0.permissions', ['receive'])
                ->where('integration.accounts.1.permissions', ['receive', 'reply'])
                ->has('integration.accounts.0.last_checked_at')
                ->where('integration.account_permissions.0.key', 'receive')
                ->has('integration.account_permissions', 3));
    }

    private function assertBlocked(MessengerSender $sender, Conversation $conversation, string $fragment): void
    {
        try {
            $sender->ensureCanSend($conversation);
            $this->fail('Sending must be blocked.');
        } catch (ChatUnavailableException $exception) {
            $this->assertStringContainsString($fragment, $exception->getMessage());
        }
    }

    private function account(string $loginId): MessengerAccount
    {
        return MessengerAccount::query()->create([
            'integration_id' => $this->integration->id,
            'login_id' => $loginId,
            'remote_id' => $loginId,
            'name' => 'Tài khoản '.$loginId,
            'status' => 'connected',
            'connected_at' => now()->subYear(),
        ]);
    }

    private function conversation(MessengerAccount $account, string $roomId, bool $incoming): Conversation
    {
        $conversation = Conversation::query()->create([
            'integration_id' => $this->integration->id,
            'messenger_account_id' => $account->id,
            'provider' => 'messenger',
            'external_chat_id' => $roomId,
            'type' => Conversation::TYPE_PRIVATE,
            'title' => 'Khách',
        ]);

        if ($incoming) {
            ChatMessage::query()->create(['conversation_id' => $conversation->id, 'direction' => 'in', 'sender_type' => 'customer', 'body' => 'hi', 'external_message_id' => '$seed'.$conversation->id]);
        }

        return $conversation;
    }

    private function admin(): Admin
    {
        return Admin::factory()->create(['system_admin' => true]);
    }

    /** @return array<string, mixed> */
    private function room(string $ownGhost, string $other, string $body): array
    {
        $member = fn (string $id): array => ['type' => 'm.room.member', 'state_key' => $id, 'content' => ['membership' => 'join']];

        return [
            'state' => ['events' => [$member('@pm:pm.local'), $member('@metabot:pm.local'), $member($ownGhost), $member($other)]],
            'timeline' => ['events' => [['type' => 'm.room.message', 'event_id' => '$'.md5($body), 'sender' => $other, 'origin_server_ts' => now()->getTimestampMs(), 'content' => ['msgtype' => 'm.text', 'body' => $body]]]],
        ];
    }

    /** @param array<string, array<string, mixed>> $rooms */
    private function ingest(array $rooms): void
    {
        app(MessengerInbox::class)->ingest($this->integration, ['rooms' => ['join' => $rooms]]);
    }

    private function fakeLoginBridge(string $loginId): void
    {
        Http::fake([
            'bridge.test/_matrix/provision/v3/whoami*' => Http::response(['logins' => []]),
            'bridge.test/_matrix/provision/v3/login/start/*' => Http::response([
                'login_id' => 'proc1', 'step_id' => 'cookies', 'type' => 'cookies',
                'cookies' => ['fields' => [['id' => 'c_user', 'required' => true], ['id' => 'xs', 'required' => true]]],
            ]),
            'bridge.test/_matrix/provision/v3/login/step/*' => Http::response([
                'login_id' => 'proc1', 'step_id' => 'done', 'type' => 'complete',
                'complete' => ['user_login_id' => $loginId, 'name' => 'Tên '.$loginId, 'remote_id' => $loginId],
            ]),
            'bridge.test/*' => Http::response('', 204),
        ]);
    }
}
