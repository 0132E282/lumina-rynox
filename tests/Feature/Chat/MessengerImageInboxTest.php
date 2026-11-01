<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\Admin;
use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\Messenger\MessengerInbox;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MessengerImageInboxTest extends TestCase
{
    use RefreshDatabase;

    private const ROOM = '!room:pm.local';

    private const GHOST = '@meta_100:pm.local';

    private const CONNECTED_AT_MS = 1_800_000_000_000;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.matrix.homeserver_url' => 'http://matrix.test',
            'services.matrix.user_id' => '@pm:pm.local',
            'services.matrix.access_token' => 'secret-token',
            'services.mautrix_meta.bot_user_id' => '@metabot:pm.local',
            'services.mautrix_meta.ghost_prefix' => '@meta_',
        ]);
        Storage::fake(MessengerInbox::ATTACHMENT_DISK);
    }

    public function test_image_is_downloaded_and_stored_privately(): void
    {
        Http::fake(['matrix.test/*' => Http::response($this->png(), 200, ['Content-Type' => 'image/png'])]);

        $this->ingest([$this->imageEvent('$img1', 'mxc://pm.local/abc123', ['body' => 'IMG_1.png', 'filename' => 'IMG_1.png'])]);

        $message = ChatMessage::query()->firstOrFail();
        $this->assertSame('', $message->body);
        $this->assertSame('image/png', $message->attachment_mime);
        $this->assertSame(2, $message->attachment_width);
        $this->assertMatchesRegularExpression('#^chat/[0-9a-f-]{36}/[0-9a-f-]{36}\.png$#', (string) $message->attachment_path);
        Storage::disk(MessengerInbox::ATTACHMENT_DISK)->assertExists($message->attachment_path);
        $this->assertSame('Đã gửi một ảnh', Conversation::query()->firstOrFail()->last_message_preview);
        Http::assertSent(fn ($request): bool => $request->url() === 'http://matrix.test/_matrix/client/v1/media/download/pm.local/abc123'
            && $request->hasHeader('Authorization', 'Bearer secret-token'));
    }

    public function test_voice_message_keeps_only_the_media_reference(): void
    {
        Http::fake();

        $this->ingest([$this->audioEvent('$aud1', 'mxc://pm.local/voice1')]);

        $message = ChatMessage::query()->firstOrFail();
        $this->assertSame('', $message->body);
        $this->assertSame('mxc://pm.local/voice1', $message->attachment_mxc);
        $this->assertSame('audio/ogg', $message->attachment_mime);
        $this->assertNull($message->attachment_path);
        $this->assertSame('Đã gửi một tin nhắn thoại', Conversation::query()->firstOrFail()->last_message_preview);
        Http::assertNothingSent();
        $this->assertSame([], Storage::disk(MessengerInbox::ATTACHMENT_DISK)->allFiles());
    }

    public function test_video_message_keeps_only_the_media_reference_with_name_and_size(): void
    {
        Http::fake();

        $this->ingest([[
            'type' => 'm.room.message', 'event_id' => '$vid1', 'sender' => self::GHOST, 'origin_server_ts' => self::CONNECTED_AT_MS + 1000,
            'content' => ['msgtype' => 'm.video', 'url' => 'mxc://pm.local/video1', 'body' => 'chan-4.mp4', 'info' => ['mimetype' => 'video/mp4', 'size' => 13_920_000]],
        ]]);

        $message = ChatMessage::query()->firstOrFail();
        $this->assertSame('', $message->body);
        $this->assertSame('mxc://pm.local/video1', $message->attachment_mxc);
        $this->assertSame('video/mp4', $message->attachment_mime);
        $this->assertSame('chan-4.mp4', $message->attachment_name);
        $this->assertSame(13_920_000, $message->attachment_size);
        $this->assertSame('Đã gửi một video', Conversation::query()->firstOrFail()->last_message_preview);
        Http::assertNothingSent();
    }

    public function test_voice_message_with_malformed_uri_falls_back_to_a_placeholder(): void
    {
        $this->ingest([$this->audioEvent('$aud1', 'https://evil.test/x')]);

        $message = ChatMessage::query()->firstOrFail();
        $this->assertSame('[Tin nhắn thoại]', $message->body);
        $this->assertNull($message->attachment_mxc);
    }

    public function test_caption_is_kept_when_it_differs_from_the_file_name(): void
    {
        Http::fake(['matrix.test/*' => Http::response($this->png())]);

        $this->ingest([$this->imageEvent('$img1', 'mxc://pm.local/abc123', ['body' => 'Xem này', 'filename' => 'IMG_1.png'])]);

        $this->assertSame('Xem này', ChatMessage::query()->firstOrFail()->body);
        $this->assertSame('Xem này', Conversation::query()->firstOrFail()->last_message_preview);
    }

    public function test_failed_download_stores_placeholder_and_does_not_break_the_batch(): void
    {
        Http::fake(['matrix.test/*' => Http::response('', 404)]);

        $this->ingest([
            $this->imageEvent('$img1', 'mxc://pm.local/gone', ['body' => 'a.png']),
            $this->textEvent('$txt1', 'xin chào'),
        ]);

        $failed = ChatMessage::query()->where('external_message_id', '$img1')->firstOrFail();
        $this->assertSame('[Ảnh]', $failed->body);
        $this->assertNull($failed->attachment_path);
        $this->assertSame(1, ChatMessage::query()->where('external_message_id', '$txt1')->count());
        $this->assertSame([], Storage::disk(MessengerInbox::ATTACHMENT_DISK)->allFiles());
    }

    public function test_non_image_bytes_are_rejected_whatever_the_declared_type(): void
    {
        Http::fake(['matrix.test/*' => Http::response('<html>x</html>', 200, ['Content-Type' => 'image/png'])]);

        $this->ingest([$this->imageEvent('$img1', 'mxc://pm.local/abc', ['body' => 'a.png'])]);

        $message = ChatMessage::query()->firstOrFail();
        $this->assertSame('[Ảnh]', $message->body);
        $this->assertNull($message->attachment_path);
    }

    public function test_oversized_image_is_rejected(): void
    {
        Http::fake(['matrix.test/*' => Http::response($this->png().str_repeat('0', MessengerInbox::MAX_IMAGE_BYTES), 200)]);

        $this->ingest([$this->imageEvent('$img1', 'mxc://pm.local/abc', ['body' => 'a.png'])]);

        $this->assertNull(ChatMessage::query()->firstOrFail()->attachment_path);
        $this->assertSame([], Storage::disk(MessengerInbox::ATTACHMENT_DISK)->allFiles());
    }

    public function test_malformed_mxc_uri_is_never_requested(): void
    {
        Http::fake();

        $this->ingest([$this->imageEvent('$img1', 'https://evil.test/x', ['body' => 'a.png'])]);

        Http::assertNothingSent();
        $this->assertSame('[Ảnh]', ChatMessage::query()->firstOrFail()->body);
    }

    public function test_history_is_stored_without_unread_or_rolling_the_preview_back(): void
    {
        $this->ingest([$this->textEvent('$new', 'tin mới', self::CONNECTED_AT_MS + 5_000)]);
        $this->ingest([$this->textEvent('$old', 'tin cũ', self::CONNECTED_AT_MS - 86_400_000)]);

        $conversation = Conversation::query()->firstOrFail();
        $this->assertSame(2, ChatMessage::query()->count());
        $this->assertSame(1, $conversation->unread_count);
        $this->assertSame('tin mới', $conversation->last_message_preview);
    }

    public function test_own_ghost_history_is_still_skipped(): void
    {
        $this->ingest([$this->textEvent('$mine', 'của tôi', self::CONNECTED_AT_MS - 1000, '@meta_999:pm.local')]);

        $this->assertSame(0, ChatMessage::query()->count());
    }

    public function test_attachment_route_requires_permission_and_sends_safe_headers(): void
    {
        Http::fake(['matrix.test/*' => Http::response($this->png())]);
        $this->ingest([$this->imageEvent('$img1', 'mxc://pm.local/abc', ['body' => 'a.png'])]);
        $url = route('chat.attachment', ChatMessage::query()->firstOrFail(), false);

        $this->get($url)->assertRedirect();
        $this->actingAs(Admin::factory()->create(['system_admin' => false]))->get($url)->assertForbidden();

        $response = $this->actingAs(Admin::factory()->create(['system_admin' => true]))->get($url);
        $response->assertOk();
        $response->assertHeader('Content-Type', 'image/png');
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringContainsString('private', (string) $response->headers->get('Cache-Control'));
    }

    public function test_voice_message_is_relayed_from_the_homeserver_with_range(): void
    {
        Http::fake(['matrix.test/*' => Http::response('abcd', 206, ['Content-Range' => 'bytes 0-3/10', 'Content-Length' => '4'])]);
        $this->ingest([$this->audioEvent('$aud1', 'mxc://pm.local/voice1')]);

        $response = $this->actingAs(Admin::factory()->create(['system_admin' => true]))
            ->withHeader('Range', 'bytes=0-3')
            ->get(route('chat.attachment', ChatMessage::query()->firstOrFail(), false));

        $response->assertStatus(206);
        $response->assertHeader('Content-Type', 'audio/ogg');
        $response->assertHeader('Content-Range', 'bytes 0-3/10');
        $this->assertSame('abcd', $response->streamedContent());
        Http::assertSent(fn ($request): bool => $request->hasHeader('Range', 'bytes=0-3') && $request->hasHeader('Authorization', 'Bearer secret-token'));
    }

    public function test_backfill_makes_an_old_unsupported_voice_message_playable(): void
    {
        Http::fake(['matrix.test/*' => Http::response($this->audioEvent('$old1', 'mxc://pm.local/voice9'))]);
        $conversation = Conversation::query()->create(['provider' => 'messenger', 'external_chat_id' => self::ROOM, 'type' => Conversation::TYPE_PRIVATE, 'title' => 'x']);
        ChatMessage::query()->create([
            'conversation_id' => $conversation->id, 'direction' => 'in', 'sender_type' => 'customer',
            'external_message_id' => '$old1', 'body' => 'Loại tin chưa hỗ trợ: tin nhắn thoại',
        ]);

        $this->artisan('chat:backfill-voice')->expectsOutput('Đã khôi phục 1/1 tin nhắn thoại.')->assertSuccessful();

        $message = ChatMessage::query()->firstOrFail();
        $this->assertSame('', $message->body);
        $this->assertSame('mxc://pm.local/voice9', $message->attachment_mxc);
    }

    public function test_attachment_route_rejects_a_tampered_path(): void
    {
        $conversation = Conversation::query()->create(['provider' => 'messenger', 'external_chat_id' => self::ROOM, 'type' => Conversation::TYPE_PRIVATE, 'title' => 'x']);
        $message = ChatMessage::query()->create([
            'conversation_id' => $conversation->id, 'direction' => 'in', 'sender_type' => 'customer', 'body' => '',
            'attachment_path' => '../../.env', 'attachment_mime' => 'image/png',
        ]);

        $this->actingAs(Admin::factory()->create(['system_admin' => true]))
            ->get(route('chat.attachment', $message, false))
            ->assertNotFound();
    }

    /** @param list<array<string, mixed>> $events */
    private function ingest(array $events): void
    {
        $integration = Integration::query()->firstOrCreate(['provider' => 'messenger'], ['status' => 'connected']);
        MessengerAccount::query()->firstOrCreate(
            ['login_id' => '999'],
            ['integration_id' => $integration->id, 'remote_id' => '999', 'status' => 'connected', 'connected_at' => date('c', intdiv(self::CONNECTED_AT_MS, 1000))],
        );
        $members = [
            ['type' => 'm.room.member', 'state_key' => '@pm:pm.local', 'content' => ['membership' => 'join']],
            ['type' => 'm.room.member', 'state_key' => '@metabot:pm.local', 'content' => ['membership' => 'join']],
            ['type' => 'm.room.member', 'state_key' => self::GHOST, 'content' => ['membership' => 'join', 'displayname' => 'Lan']],
        ];

        app(MessengerInbox::class)->ingest($integration, [
            'rooms' => ['join' => [self::ROOM => ['state' => ['events' => $members], 'timeline' => ['events' => $events]]]],
        ]);
    }

    /**
     * @param  array<string, mixed>  $content
     * @return array<string, mixed>
     */
    private function imageEvent(string $id, string $url, array $content): array
    {
        return [
            'type' => 'm.room.message', 'event_id' => $id, 'sender' => self::GHOST, 'origin_server_ts' => self::CONNECTED_AT_MS + 1000,
            'content' => ['msgtype' => 'm.image', 'url' => $url, ...$content],
        ];
    }

    /** @return array<string, mixed> */
    private function audioEvent(string $id, string $url): array
    {
        return [
            'type' => 'm.room.message', 'event_id' => $id, 'sender' => self::GHOST, 'origin_server_ts' => self::CONNECTED_AT_MS + 1000,
            'content' => ['msgtype' => 'm.audio', 'url' => $url, 'body' => 'voice.ogg', 'info' => ['mimetype' => 'audio/ogg', 'size' => 1234]],
        ];
    }

    /** @return array<string, mixed> */
    private function textEvent(string $id, string $body, int $ts = self::CONNECTED_AT_MS + 1000, string $sender = self::GHOST): array
    {
        return ['type' => 'm.room.message', 'event_id' => $id, 'sender' => $sender, 'origin_server_ts' => $ts, 'content' => ['msgtype' => 'm.text', 'body' => $body]];
    }

    private function png(): string
    {
        $image = imagecreatetruecolor(2, 2);
        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    }
}
