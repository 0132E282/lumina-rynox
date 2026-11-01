<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\Admin;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\Messenger\MessengerInbox;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MessengerAccountForgetTest extends TestCase
{
    use RefreshDatabase;

    private Integration $integration;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake(MessengerInbox::ATTACHMENT_DISK);
        $this->integration = Integration::query()->create(['provider' => 'messenger', 'status' => 'connected']);
    }

    public function test_a_disconnected_account_is_deleted_with_its_avatar_and_leftover_conversations(): void
    {
        $avatar = 'chat/avatars/accounts/1/123e4567-e89b-12d3-a456-426614174000.png';
        Storage::disk(MessengerInbox::ATTACHMENT_DISK)->put($avatar, 'png');
        $account = $this->account('111', Integration::STATUS_DISCONNECTED, $avatar);
        $other = $this->account('222', Integration::STATUS_CONNECTED);
        Conversation::query()->create([
            'integration_id' => $this->integration->id,
            'messenger_account_id' => $account->id,
            'provider' => 'messenger',
            'external_chat_id' => '!a:pm.local',
            'type' => Conversation::TYPE_PRIVATE,
            'title' => 'Khách',
        ]);

        $this->actingAs($this->admin())->delete($this->url($account))
            ->assertRedirect(route('integrations.show', ['provider' => 'messenger'], false));

        $this->assertModelMissing($account);
        $this->assertModelExists($other);
        $this->assertSame(0, Conversation::query()->count());
        Storage::disk(MessengerInbox::ATTACHMENT_DISK)->assertMissing($avatar);
    }

    public function test_a_connected_or_errored_account_is_refused(): void
    {
        $this->actingAs($this->admin());

        foreach ([Integration::STATUS_CONNECTED, Integration::STATUS_ERROR] as $status) {
            $account = $this->account('3'.$status, $status);

            $this->delete($this->url($account))->assertStatus(409);
            $this->assertModelExists($account);
        }
    }

    public function test_it_needs_the_integrations_update_permission(): void
    {
        $account = $this->account('111', Integration::STATUS_DISCONNECTED);

        $this->actingAs(Admin::factory()->create(['system_admin' => false]))->delete($this->url($account))->assertForbidden();
        $this->assertModelExists($account);
    }

    private function url(MessengerAccount $account): string
    {
        return route('integrations.messenger.accounts.forget', $account, false);
    }

    private function account(string $loginId, string $status, ?string $avatarPath = null): MessengerAccount
    {
        return MessengerAccount::query()->create([
            'integration_id' => $this->integration->id,
            'login_id' => $loginId,
            'remote_id' => $loginId,
            'name' => 'Tài khoản '.$loginId,
            'status' => $status,
            'avatar_path' => $avatarPath,
        ]);
    }

    private function admin(): Admin
    {
        return Admin::factory()->create(['system_admin' => true]);
    }
}
