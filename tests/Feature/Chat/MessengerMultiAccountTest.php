<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\Admin;
use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\Messenger\MessengerChannel;
use App\Services\Chat\Messenger\MessengerInbox;
use App\Services\Chat\Messenger\MessengerSender;
use App\Services\Chat\Telegram\ChatUnavailableException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MessengerMultiAccountTest extends TestCase
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
        $this->first = $this->account('111', 'An');
        $this->second = $this->account('222', 'Bình');
    }

    public function test_rooms_are_routed_to_the_account_whose_ghost_is_inside(): void
    {
        $this->ingest([
            '!a:pm.local' => $this->room('@meta_111:pm.local', '@meta_900:pm.local', [$this->text('$a1', '@meta_900:pm.local', 'chào An')]),
            '!b:pm.local' => $this->room('@meta_222:pm.local', '@meta_901:pm.local', [$this->text('$b1', '@meta_901:pm.local', 'chào Bình')]),
        ]);

        $this->assertSame($this->first->id, Conversation::query()->where('external_chat_id', '!a:pm.local')->firstOrFail()->messenger_account_id);
        $this->assertSame($this->second->id, Conversation::query()->where('external_chat_id', '!b:pm.local')->firstOrFail()->messenger_account_id);
        $this->assertSame(2, ChatMessage::query()->count());
    }

    public function test_messages_from_every_own_ghost_are_skipped_and_two_own_accounts_are_not_a_chat(): void
    {
        $this->ingest([
            '!a:pm.local' => $this->room('@meta_111:pm.local', '@meta_900:pm.local', [
                $this->text('$own1', '@meta_111:pm.local', 'của An'),
                $this->text('$own2', '@meta_222:pm.local', 'của Bình'),
                $this->text('$in', '@meta_900:pm.local', 'từ khách'),
            ]),
            '!both:pm.local' => $this->room('@meta_111:pm.local', '@meta_222:pm.local', [$this->text('$x', '@meta_222:pm.local', 'giữa hai tài khoản')]),
        ]);

        $this->assertSame(['$in'], ChatMessage::query()->pluck('external_message_id')->all());
        $this->assertSame(0, Conversation::query()->where('external_chat_id', '!both:pm.local')->count());
    }

    public function test_send_uses_the_conversation_account_and_checks_its_own_login(): void
    {
        $conversationA = $this->conversation($this->first, '!a:pm.local');
        $conversationB = $this->conversation($this->second, '!b:pm.local');
        // * The bridge says 111 is connected but 222 is not: only the conversation of 222 is blocked.
        Http::fake([
            'bridge.test/*' => Http::response(['logins' => [
                ['id' => '111', 'state' => ['state_event' => 'CONNECTED']],
                ['id' => '222', 'state' => ['state_event' => 'BAD_CREDENTIALS']],
            ]]),
            'matrix.test/*' => Http::response(['event_id' => '$sent']),
        ]);

        $message = app(MessengerSender::class)->send($conversationA, 'xin chào', 'tok-a', 'Nhân viên');
        $this->assertSame(ChatMessage::STATUS_SENT, $message->send_status);

        $this->expectException(ChatUnavailableException::class);
        app(MessengerSender::class)->send($conversationB, 'xin chào', 'tok-b', 'Nhân viên');
    }

    public function test_a_file_is_uploaded_then_sent_as_m_file_with_its_caption_and_a_repeat_sends_nothing(): void
    {
        $conversation = $this->conversation($this->first, '!a:pm.local');
        Http::fake([
            'bridge.test/*' => Http::response(['logins' => [['id' => '111', 'state' => ['state_event' => 'CONNECTED']]]]),
            'matrix.test/_matrix/media/v3/upload*' => Http::response(['content_uri' => 'mxc://pm.local/abc123']),
            'matrix.test/*' => fn () => Http::response(['event_id' => '$e'.uniqid()]),
        ]);
        $file = UploadedFile::fake()->create('bao-gia.pdf', 20, 'application/pdf');

        $message = app(MessengerSender::class)->sendAttachment($conversation, $file, 'Gửi anh báo giá', 'tok-file', 'Nhân viên');

        $this->assertSame(ChatMessage::STATUS_SENT, $message->send_status);
        $this->assertSame('bao-gia.pdf', $message->attachment_name);
        $this->assertMatchesRegularExpression('#^chat/'.$conversation->id.'/[0-9a-f-]{36}\.pdf$#', (string) $message->attachment_path);
        Storage::disk(MessengerInbox::ATTACHMENT_DISK)->assertExists((string) $message->attachment_path);
        Http::assertSent(fn (Request $request): bool => str_contains($request->url(), '/_matrix/media/v3/upload?filename=bao-gia.pdf'));
        Http::assertSent(fn (Request $request): bool => $request->method() === 'PUT' && ($request['msgtype'] ?? null) === 'm.file' && $request['url'] === 'mxc://pm.local/abc123');
        Http::assertSent(fn (Request $request): bool => ($request['msgtype'] ?? null) === 'm.text' && $request['body'] === 'Gửi anh báo giá');

        $sentBefore = count(Http::recorded());
        app(MessengerSender::class)->sendAttachment($conversation, $file, 'Gửi anh báo giá', 'tok-file', 'Nhân viên');
        $this->assertSame($sentBefore + 1, count(Http::recorded()), 'Only the bridge login check may repeat; no upload or send.');
        $this->assertSame(1, ChatMessage::query()->where('client_token', 'tok-file')->count());
    }

    public function test_an_office_file_with_a_long_mime_type_is_stored(): void
    {
        $conversation = $this->conversation($this->first, '!a:pm.local');
        Http::fake([
            'bridge.test/*' => Http::response(['logins' => [['id' => '111', 'state' => ['state_event' => 'CONNECTED']]]]),
            'matrix.test/_matrix/media/v3/upload*' => Http::response(['content_uri' => 'mxc://pm.local/abc123']),
            'matrix.test/*' => fn () => Http::response(['event_id' => '$e'.uniqid()]),
        ]);
        $xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        $message = app(MessengerSender::class)->sendAttachment($conversation, UploadedFile::fake()->create('faq.xlsx', 5, $xlsx), '', 'tok-xlsx', 'Nhân viên');

        $this->assertSame(ChatMessage::STATUS_SENT, $message->send_status);
        $this->assertSame(strlen($xlsx) > 50 ? $xlsx : null, $message->fresh()->attachment_mime);
    }

    public function test_a_voice_recording_is_sent_as_a_matrix_voice_message_and_played_back_inline(): void
    {
        $conversation = $this->conversation($this->first, '!a:pm.local');
        Http::fake([
            'bridge.test/*' => Http::response(['logins' => [['id' => '111', 'state' => ['state_event' => 'CONNECTED']]]]),
            'matrix.test/_matrix/media/v3/upload*' => Http::response(['content_uri' => 'mxc://pm.local/voice1']),
            'matrix.test/*' => fn () => Http::response(['event_id' => '$e'.uniqid()]),
        ]);
        // * Not real audio, so the converter fails and the recording goes out as recorded.
        $file = UploadedFile::fake()->createWithContent('voice-1.webm', 'not-really-audio');

        $message = app(MessengerSender::class)->sendAttachment($conversation, $file, '', 'tok-voice', 'Nhân viên');

        $this->assertSame(ChatMessage::STATUS_SENT, $message->send_status);
        $this->assertSame('audio/webm', $message->attachment_mime);
        Http::assertSent(fn (Request $request): bool => $request->method() === 'PUT' && ($request['msgtype'] ?? null) === 'm.audio' && isset($request['org.matrix.msc3245.voice']));

        $response = $this->actingAs($this->systemAdmin())->get(route('chat.attachment', $message, false));
        $response->assertOk();
        $response->assertHeader('Content-Type', 'audio/webm');
    }

    public function test_a_webp_image_is_sent_to_messenger_as_jpeg_and_the_original_stays_stored(): void
    {
        $conversation = $this->conversation($this->first, '!a:pm.local');
        Http::fake([
            'bridge.test/*' => Http::response(['logins' => [['id' => '111', 'state' => ['state_event' => 'CONNECTED']]]]),
            'matrix.test/_matrix/media/v3/upload*' => Http::response(['content_uri' => 'mxc://pm.local/abc123']),
            'matrix.test/*' => fn () => Http::response(['event_id' => '$e'.uniqid()]),
        ]);
        $canvas = imagecreatetruecolor(4, 4);
        ob_start();
        imagewebp($canvas);
        $webp = (string) ob_get_clean();
        $file = UploadedFile::fake()->createWithContent('anh.webp', $webp);

        $message = app(MessengerSender::class)->sendAttachment($conversation, $file, '', 'tok-webp', 'Nhân viên');

        $this->assertSame(ChatMessage::STATUS_SENT, $message->send_status);
        $this->assertSame('image/webp', $message->attachment_mime);
        Http::assertSent(fn (Request $request): bool => str_contains($request->url(), '/_matrix/media/v3/upload?filename=anh.jpg') && $request->hasHeader('Content-Type', 'image/jpeg'));
        Http::assertSent(fn (Request $request): bool => $request->method() === 'PUT' && ($request['body'] ?? null) === 'anh.jpg' && ($request['info']['mimetype'] ?? null) === 'image/jpeg');
    }

    public function test_the_send_attachment_route_rejects_unlisted_types_and_oversized_files(): void
    {
        $conversation = $this->conversation($this->first, '!a:pm.local');
        Http::fake();
        $admin = $this->systemAdmin();
        $url = route('chat.send-attachment', $conversation);

        $this->actingAs($admin)->post($url, ['client_token' => 'a1', 'file' => UploadedFile::fake()->create('x.exe', 5)])->assertSessionHasErrors('file');
        $this->actingAs($admin)->post($url, ['client_token' => 'a2', 'file' => UploadedFile::fake()->create('big.pdf', 10241, 'application/pdf')])->assertSessionHasErrors('file');
        Http::assertNothingSent();
    }

    public function test_send_is_blocked_for_a_disconnected_account_or_a_conversation_without_one(): void
    {
        Http::fake();
        $this->second->forceFill(['status' => 'error'])->save();
        $sender = app(MessengerSender::class);

        try {
            $sender->ensureCanSend($this->conversation($this->second, '!b:pm.local'));
            $this->fail('A disconnected account must not send.');
        } catch (ChatUnavailableException $exception) {
            $this->assertStringContainsString('mất kết nối', $exception->getMessage());
        }

        try {
            $sender->ensureCanSend($this->conversation(null, '!c:pm.local'));
            $this->fail('A conversation without an account must not send.');
        } catch (ChatUnavailableException $exception) {
            $this->assertStringContainsString('chưa gắn', $exception->getMessage());
        }

        Http::assertNothingSent();
    }

    public function test_send_rate_limit_is_per_account(): void
    {
        config(['services.mautrix_meta.send_per_minute' => 1]);
        Http::fake([
            'bridge.test/*' => Http::response(['logins' => [
                ['id' => '111', 'state' => ['state_event' => 'CONNECTED']],
                ['id' => '222', 'state' => ['state_event' => 'CONNECTED']],
            ]]),
            'matrix.test/*' => fn () => Http::response(['event_id' => '$sent'.uniqid()]),
        ]);
        RateLimiter::clear('messenger-send:'.$this->first->id);
        $conversationA = $this->conversation($this->first, '!a:pm.local');
        $conversationB = $this->conversation($this->second, '!b:pm.local');
        $sender = app(MessengerSender::class);

        $sender->send($conversationA, 'một', 'tok-1', null);
        $sender->send($conversationB, 'hai', 'tok-2', null);

        $this->expectException(ChatUnavailableException::class);
        $sender->send($conversationA, 'ba', 'tok-3', null);
    }

    public function test_login_adds_an_account_without_logging_out_the_others(): void
    {
        $this->fakeLoginBridge(existing: ['111']);

        $response = $this->actingAs($this->systemAdmin())->postJson(route('integrations.messenger.login'), [
            'risk_acknowledged' => true,
            'cookies' => 'c_user=333; xs=abc',
        ]);

        $response->assertOk();
        $this->assertSame(3, MessengerAccount::query()->count());
        $this->assertSame('connected', MessengerAccount::query()->where('login_id', '333')->firstOrFail()->status);
        Http::assertNotSent(fn (Request $request): bool => str_contains($request->url(), '/logout/'));
    }

    public function test_login_replaces_only_the_login_of_the_same_facebook_account(): void
    {
        $this->fakeLoginBridge(existing: ['111', '222'], completeAs: '222');

        $this->actingAs($this->systemAdmin())->postJson(route('integrations.messenger.login'), [
            'risk_acknowledged' => true,
            'cookies' => 'c_user=222; xs=abc',
        ])->assertOk();

        Http::assertSent(fn (Request $request): bool => str_contains($request->url(), '/logout/222'));
        Http::assertNotSent(fn (Request $request): bool => str_contains($request->url(), '/logout/111'));
        $this->assertSame(2, MessengerAccount::query()->count());
    }

    public function test_disconnecting_one_account_deletes_its_conversations_and_keeps_the_other(): void
    {
        $conversation = $this->conversation($this->first, '!a:pm.local');
        $other = $this->conversation($this->second, '!b:pm.local');
        Http::fake(['bridge.test/*' => Http::response('', 204)]);

        $this->actingAs($this->systemAdmin())
            ->delete(route('integrations.messenger.accounts.destroy', $this->first, false))
            ->assertRedirect();

        $this->assertSame('disconnected', $this->first->fresh()->status);
        $this->assertSame('connected', $this->second->fresh()->status);
        $this->assertSame('connected', $this->integration->fresh()->status);
        $this->assertFalse(Conversation::query()->whereKey($conversation->id)->exists());
        $this->assertTrue(Conversation::query()->whereKey($other->id)->exists());
        Http::assertSent(fn (Request $request): bool => $request->method() === 'POST' && str_contains($request->url(), '/logout/111'));

        $this->actingAs($this->systemAdmin())->delete(route('integrations.messenger.accounts.destroy', $this->second, false));
        $this->assertSame('disconnected', $this->integration->fresh()->status);
        $this->assertNull(app(MessengerChannel::class)->connected());
    }

    public function test_account_routes_require_permission(): void
    {
        $plain = Admin::factory()->create(['system_admin' => false]);
        $deleteUrl = route('integrations.messenger.accounts.destroy', $this->first, false);
        $avatarUrl = route('integrations.messenger.accounts.avatar', $this->first, false);

        $this->delete($deleteUrl)->assertRedirect();
        $this->actingAs($plain)->delete($deleteUrl)->assertForbidden();
        $this->actingAs($plain)->get($avatarUrl)->assertForbidden();
        $this->actingAs($plain)->get(route('chat.account-avatar', $this->first, false))->assertForbidden();
        $this->assertSame('connected', $this->first->fresh()->status);

        $this->actingAs($this->systemAdmin())->get($avatarUrl)->assertNotFound();
    }

    public function test_account_avatar_is_served_with_safe_headers(): void
    {
        $path = 'chat/avatars/accounts/'.$this->first->id.'/3d429556-b21a-44e4-a5a8-2061b9a95e2e.png';
        Storage::disk(MessengerInbox::ATTACHMENT_DISK)->put($path, 'png-bytes');
        $this->first->forceFill(['avatar_path' => $path])->save();

        $response = $this->actingAs($this->systemAdmin())->get(route('chat.account-avatar', $this->first, false));

        $response->assertOk();
        $response->assertHeader('Content-Type', 'image/png');
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_channel_is_connected_while_any_account_is_and_state_is_tracked_per_account(): void
    {
        $channel = app(MessengerChannel::class);

        $channel->markAccountState($this->first, 'BAD_CREDENTIALS', 'An mới');
        $this->assertSame('error', $this->first->fresh()->status);
        $this->assertSame('An mới', $this->first->fresh()->name);
        $this->assertNotNull($channel->connected());

        $channel->markAccountState($this->second, null);
        $this->assertNull($channel->connected());
        $this->assertSame('error', $this->integration->fresh()->status);

        $channel->markAccountState($this->second, 'CONNECTED');
        $this->assertSame('connected', $this->integration->fresh()->status);
    }

    private function account(string $loginId, string $name): MessengerAccount
    {
        return MessengerAccount::query()->create([
            'integration_id' => $this->integration->id,
            'login_id' => $loginId,
            'remote_id' => $loginId,
            'name' => $name,
            'status' => 'connected',
            'connected_at' => now()->subYear(),
        ]);
    }

    private function conversation(?MessengerAccount $account, string $roomId): Conversation
    {
        $conversation = Conversation::query()->create([
            'integration_id' => $this->integration->id,
            'messenger_account_id' => $account?->id,
            'provider' => 'messenger',
            'external_chat_id' => $roomId,
            'type' => Conversation::TYPE_PRIVATE,
            'title' => 'Khách',
        ]);
        ChatMessage::query()->create([
            'conversation_id' => $conversation->id, 'direction' => 'in', 'sender_type' => 'customer',
            'body' => 'hi', 'external_message_id' => '$seed'.$conversation->id,
        ]);

        return $conversation;
    }

    private function systemAdmin(): Admin
    {
        return Admin::factory()->create(['system_admin' => true]);
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @return array<string, mixed>
     */
    private function room(string $ownGhost, string $other, array $events): array
    {
        $member = fn (string $id): array => ['type' => 'm.room.member', 'state_key' => $id, 'content' => ['membership' => 'join']];

        return [
            'state' => ['events' => [$member('@pm:pm.local'), $member('@metabot:pm.local'), $member($ownGhost), $member($other)]],
            'timeline' => ['events' => $events],
        ];
    }

    /** @return array<string, mixed> */
    private function text(string $id, string $sender, string $body): array
    {
        return ['type' => 'm.room.message', 'event_id' => $id, 'sender' => $sender, 'origin_server_ts' => now()->getTimestampMs(), 'content' => ['msgtype' => 'm.text', 'body' => $body]];
    }

    /** @param array<string, array<string, mixed>> $rooms */
    private function ingest(array $rooms): void
    {
        app(MessengerInbox::class)->ingest($this->integration, ['rooms' => ['join' => $rooms]]);
    }

    /** @param list<string> $existing */
    private function fakeLoginBridge(array $existing, string $completeAs = '333'): void
    {
        $logins = array_map(fn (string $id): array => ['id' => $id, 'remote_id' => $id, 'state' => ['state_event' => 'CONNECTED']], $existing);

        Http::fake([
            'bridge.test/_matrix/provision/v3/whoami*' => Http::response(['logins' => $logins]),
            'bridge.test/_matrix/provision/v3/login/start/*' => Http::response([
                'login_id' => 'proc1', 'step_id' => 'cookies', 'type' => 'cookies',
                'cookies' => ['fields' => [['id' => 'c_user', 'required' => true], ['id' => 'xs', 'required' => true]]],
            ]),
            'bridge.test/_matrix/provision/v3/login/step/*' => Http::response([
                'login_id' => 'proc1', 'step_id' => 'done', 'type' => 'complete',
                'complete' => ['user_login_id' => $completeAs, 'name' => 'Tên '.$completeAs, 'remote_id' => $completeAs],
            ]),
            'bridge.test/*' => Http::response('', 204),
        ]);
    }
}
