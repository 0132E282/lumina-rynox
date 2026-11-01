<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\Admin;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

class ChatLinkPreviewTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_returns_title_description_and_image_of_a_public_page(): void
    {
        Http::fake(['*' => Http::response(
            '<html><head><meta property="og:title" content="ChatGPT"><meta property="og:description" content="Trả lời câu hỏi"><meta property="og:image" content="/card.png"></head></html>',
            200,
            ['Content-Type' => 'text/html; charset=utf-8'],
        )]);

        $this->actingAs($this->admin())
            ->postJson(route('chat.link-preview'), ['url' => 'http://93.184.216.34/c/abc'])
            ->assertOk()
            ->assertJsonPath('preview.title', 'ChatGPT')
            ->assertJsonPath('preview.description', 'Trả lời câu hỏi')
            ->assertJsonPath('preview.image', 'http://93.184.216.34/card.png');
    }

    public function test_it_never_fetches_a_private_or_loopback_address(): void
    {
        Http::fake();

        foreach (['http://127.0.0.1/', 'http://10.0.0.5/admin', 'http://169.254.169.254/latest/meta-data'] as $url) {
            $this->actingAs($this->admin())
                ->postJson(route('chat.link-preview'), ['url' => $url])
                ->assertOk()
                ->assertJsonPath('preview', null);
        }

        Http::assertNothingSent();
    }

    public function test_a_redirect_to_a_private_address_is_refused(): void
    {
        Http::fake(['*' => Http::response('', 302, ['Location' => 'http://127.0.0.1/secret'])]);

        $this->actingAs($this->admin())
            ->postJson(route('chat.link-preview'), ['url' => 'http://93.184.216.34/'])
            ->assertOk()
            ->assertJsonPath('preview', null);

        Http::assertSentCount(1);
    }

    public function test_it_needs_the_reply_permission_and_an_http_address(): void
    {
        $this->actingAs($this->admin(['conversations.view']))
            ->postJson(route('chat.link-preview'), ['url' => 'http://93.184.216.34/'])
            ->assertForbidden();

        $this->actingAs($this->admin())
            ->postJson(route('chat.link-preview'), ['url' => 'file:///etc/passwd'])
            ->assertUnprocessable();
    }

    private function admin(array $permissions = ['conversations.view', 'conversations.reply']): Admin
    {
        $admin = Admin::factory()->create(['system_admin' => false]);

        foreach ($permissions as $permission) {
            $admin->givePermissionTo(Permission::findOrCreate($permission, 'web'));
        }

        return $admin;
    }
}
