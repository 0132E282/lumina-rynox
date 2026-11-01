<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\Admin;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\Messenger\MessengerInbox;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MessengerAvatarInboxTest extends TestCase
{
    use RefreshDatabase;

    private const ROOM = '!room:pm.local';

    private const GHOST = '@meta_100:pm.local';

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

    public function test_customer_avatar_is_downloaded_and_exposed(): void
    {
        Http::fake(['matrix.test/*' => Http::response($this->png())]);

        $this->ingest('mxc://pm.local/ghostavatar');

        $conversation = Conversation::query()->firstOrFail();
        $this->assertSame('mxc://pm.local/ghostavatar', $conversation->avatar_mxc);
        $this->assertMatchesRegularExpression('#^chat/avatars/[0-9a-f-]{36}/[0-9a-f-]{36}\.png$#', (string) $conversation->avatar_path);
        Storage::disk(MessengerInbox::ATTACHMENT_DISK)->assertExists($conversation->avatar_path);
        Http::assertSent(fn ($request): bool => $request->url() === 'http://matrix.test/_matrix/client/v1/media/download/pm.local/ghostavatar');
    }

    public function test_own_ghost_avatar_is_ignored_and_room_avatar_is_the_fallback(): void
    {
        Http::fake(['matrix.test/*' => fn () => Http::response($this->png())]);

        $this->ingest(null, ownGhostAvatar: 'mxc://pm.local/mine', roomAvatar: 'mxc://pm.local/room');

        $this->assertSame('mxc://pm.local/room', Conversation::query()->firstOrFail()->avatar_mxc);
        // * The owner's own picture belongs to the account, not to the conversation.
        $this->assertSame('mxc://pm.local/mine', MessengerAccount::query()->firstOrFail()->avatar_mxc);
    }

    public function test_failed_download_still_creates_the_conversation(): void
    {
        Http::fake(['matrix.test/*' => Http::response('', 404)]);

        $this->ingest('mxc://pm.local/gone');

        $conversation = Conversation::query()->firstOrFail();
        $this->assertNull($conversation->avatar_path);
        $this->assertNull($conversation->avatar_mxc);
    }

    public function test_unchanged_mxc_is_not_downloaded_again_but_a_new_one_is(): void
    {
        // * A callback builds a fresh body per request (one response object would be read to its end once).
        Http::fake(['matrix.test/*' => fn () => Http::response($this->png())]);

        $this->ingest('mxc://pm.local/one');
        $this->ingest('mxc://pm.local/one');
        Http::assertSentCount(1);

        $oldPath = Conversation::query()->firstOrFail()->avatar_path;
        $this->ingest('mxc://pm.local/two');
        Http::assertSentCount(2);
        Storage::disk(MessengerInbox::ATTACHMENT_DISK)->assertMissing($oldPath);
        $this->assertSame('mxc://pm.local/two', Conversation::query()->firstOrFail()->avatar_mxc);
    }

    public function test_batch_without_state_keeps_the_avatar(): void
    {
        Http::fake(['matrix.test/*' => Http::response($this->png())]);
        $this->ingest('mxc://pm.local/one');

        $integration = Integration::query()->firstOrFail();
        app(MessengerInbox::class)->ingest($integration, ['rooms' => ['join' => [self::ROOM => ['timeline' => ['events' => []]]]]]);

        Http::assertSentCount(1);
        $this->assertNotNull(Conversation::query()->firstOrFail()->avatar_path);
    }

    public function test_avatar_route_requires_permission_and_sends_safe_headers(): void
    {
        Http::fake(['matrix.test/*' => Http::response($this->png())]);
        $this->ingest('mxc://pm.local/one');
        $conversation = Conversation::query()->firstOrFail();
        $url = route('chat.avatar', $conversation, false);

        $this->get($url)->assertRedirect();
        $this->actingAs(Admin::factory()->create(['system_admin' => false]))->get($url)->assertForbidden();

        $response = $this->actingAs(Admin::factory()->create(['system_admin' => true]))->get($url);
        $response->assertOk();
        $response->assertHeader('Content-Type', 'image/png');
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_avatar_route_is_404_without_a_picture_or_with_a_tampered_path(): void
    {
        $conversation = Conversation::query()->create(['provider' => 'messenger', 'external_chat_id' => self::ROOM, 'type' => Conversation::TYPE_PRIVATE, 'title' => 'x']);
        $admin = Admin::factory()->create(['system_admin' => true]);

        $this->actingAs($admin)->get(route('chat.avatar', $conversation, false))->assertNotFound();

        $conversation->forceFill(['avatar_path' => '../../.env'])->save();
        $this->actingAs($admin)->get(route('chat.avatar', $conversation, false))->assertNotFound();
    }

    private function ingest(?string $ghostAvatar, ?string $ownGhostAvatar = null, ?string $roomAvatar = null): void
    {
        $integration = Integration::query()->firstOrCreate(['provider' => 'messenger'], ['status' => 'connected']);
        MessengerAccount::query()->firstOrCreate(
            ['login_id' => '999'],
            ['integration_id' => $integration->id, 'remote_id' => '999', 'status' => 'connected'],
        );
        $state = [
            ['type' => 'm.room.member', 'state_key' => '@pm:pm.local', 'content' => ['membership' => 'join']],
            ['type' => 'm.room.member', 'state_key' => '@metabot:pm.local', 'content' => ['membership' => 'join']],
            ['type' => 'm.room.member', 'state_key' => self::GHOST, 'content' => ['membership' => 'join', 'displayname' => 'Lan'] + ($ghostAvatar === null ? [] : ['avatar_url' => $ghostAvatar])],
        ];

        if ($ownGhostAvatar !== null) {
            $state[] = ['type' => 'm.room.member', 'state_key' => '@meta_999:pm.local', 'content' => ['membership' => 'join', 'avatar_url' => $ownGhostAvatar]];
        }

        if ($roomAvatar !== null) {
            $state[] = ['type' => 'm.room.avatar', 'state_key' => '', 'content' => ['url' => $roomAvatar]];
        }

        app(MessengerInbox::class)->ingest($integration, [
            'rooms' => ['join' => [self::ROOM => ['state' => ['events' => $state], 'timeline' => ['events' => []]]]],
        ]);
    }

    private function png(): string
    {
        $image = imagecreatetruecolor(2, 2);
        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    }
}
