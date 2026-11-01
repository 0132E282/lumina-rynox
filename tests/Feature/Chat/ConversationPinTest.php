<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\Admin;
use App\Models\Conversation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Arr;
use Inertia\Testing\AssertableInertia as Assert;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

class ConversationPinTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_pinned_conversation_leads_the_inbox_and_chat_lists_even_when_older(): void
    {
        $newer = $this->conversation('Mới', '2026-10-31 10:00:00');
        $older = $this->conversation('Cũ', '2026-10-30 10:00:00');
        $admin = $this->admin(['conversations.view', 'conversations.reply']);

        $this->actingAs($admin)->put(route('chat.pin', $older), ['pinned' => true])->assertRedirect();

        $this->assertNotNull($older->fresh()->pinned_at);
        $this->assertSame(['Cũ', 'Mới'], $this->titles($admin, 'inbox.index', 'items.data'));
        $this->assertSame(['Cũ', 'Mới'], $this->titles($admin, 'chat.index', 'conversations'));
        $this->actingAs($admin)->get(route('chat.index'))
            ->assertInertia(fn (Assert $page) => $page->where('conversations.0.pinned', true)->where('conversations.1.pinned', false));

        $this->assertNull($newer->fresh()->pinned_at);
    }

    public function test_unpinning_restores_the_activity_order(): void
    {
        $this->conversation('Mới', '2026-10-31 10:00:00');
        $older = $this->conversation('Cũ', '2026-10-30 10:00:00');
        $admin = $this->admin(['conversations.view', 'conversations.reply']);

        $this->actingAs($admin)->put(route('chat.pin', $older), ['pinned' => true])->assertRedirect();
        $this->actingAs($admin)->put(route('chat.pin', $older), ['pinned' => false])->assertRedirect();

        $this->assertNull($older->fresh()->pinned_at);
        $this->assertSame(['Mới', 'Cũ'], $this->titles($admin, 'inbox.index', 'items.data'));
        $this->assertSame(['Mới', 'Cũ'], $this->titles($admin, 'chat.index', 'conversations'));
    }

    public function test_pinned_conversations_keep_the_activity_order_among_themselves(): void
    {
        $first = $this->conversation('A', '2026-10-31 10:00:00');
        $second = $this->conversation('B', '2026-10-29 10:00:00');
        $this->conversation('C', '2026-10-30 10:00:00');
        $admin = $this->admin(['conversations.view', 'conversations.reply']);

        $this->actingAs($admin)->put(route('chat.pin', $second), ['pinned' => true]);
        $this->actingAs($admin)->put(route('chat.pin', $first), ['pinned' => true]);

        $this->assertSame(['A', 'B', 'C'], $this->titles($admin, 'inbox.index', 'items.data'));
    }

    public function test_pinning_needs_the_reply_permission(): void
    {
        $conversation = $this->conversation('Khách', '2026-10-31 10:00:00');

        $this->actingAs($this->admin(['conversations.view']))
            ->put(route('chat.pin', $conversation), ['pinned' => true])
            ->assertForbidden();

        $this->assertNull($conversation->fresh()->pinned_at);
    }

    public function test_a_non_uuid_conversation_id_is_not_found(): void
    {
        $this->actingAs($this->admin(['conversations.view', 'conversations.reply']))
            ->put('/chat/123/pin', ['pinned' => true])
            ->assertNotFound();
    }

    /** @return list<string> */
    private function titles(Admin $admin, string $route, string $path): array
    {
        $titles = [];

        $this->actingAs($admin)->get(route($route))
            ->assertInertia(function (Assert $page) use (&$titles, $path): void {
                $titles = Arr::pluck(Arr::get($page->toArray()['props'], $path), 'title');
            });

        return $titles;
    }

    private function admin(array $permissions): Admin
    {
        $admin = Admin::factory()->create(['system_admin' => false]);

        foreach ($permissions as $permission) {
            $admin->givePermissionTo(Permission::findOrCreate($permission, 'web'));
        }

        return $admin;
    }

    private function conversation(string $title, string $lastMessageAt): Conversation
    {
        return Conversation::query()->create([
            'provider' => 'telegram',
            'external_chat_id' => uniqid('tg', true),
            'type' => 'private',
            'title' => $title,
            'last_message_at' => $lastMessageAt,
            'last_message_preview' => 'Tin cuối',
            'last_message_direction' => 'in',
        ]);
    }
}
