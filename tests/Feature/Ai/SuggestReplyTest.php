<?php

declare(strict_types=1);

namespace Tests\Feature\Ai;

use App\Models\Admin;
use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Cv;
use App\Services\Ai\AiException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Spatie\Permission\Models\Permission;

class SuggestReplyTest extends AiTestCase
{
    private Conversation $conversation;

    protected function setUp(): void
    {
        parent::setUp();

        $this->conversation = Conversation::query()->create(['provider' => 'telegram', 'external_chat_id' => '1', 'type' => 'private', 'title' => 'Khách']);
        ChatMessage::query()->create(['conversation_id' => $this->conversation->id, 'direction' => 'in', 'sender_type' => 'customer', 'body' => 'Giá bao nhiêu?', 'sent_at' => now()]);
    }

    public function test_a_post_draft_returns_a_title_taken_from_the_first_line_and_uses_the_cv_profile(): void
    {
        Http::fake(['api.anthropic.com/*' => Http::response(['content' => [['type' => 'text', 'text' => "TIÊU ĐỀ: Khoá NestJS cho người mới\nHọc NestJS từ con số 0, đăng ký ngay hôm nay."]]])]);
        $this->account();
        Cv::query()->create(['name' => 'CV chính', 'position' => 'Backend Engineer', 'content' => 'Sáu năm kinh nghiệm NestJS', 'is_default' => true]);

        $this->actingAs($this->admin())->postJson(route('ai.post-draft'), ['idea' => 'khoá nestjs'])
            ->assertOk()
            ->assertExactJson(['title' => 'Khoá NestJS cho người mới', 'draft' => 'Học NestJS từ con số 0, đăng ký ngay hôm nay.']);

        Http::assertSent(fn ($request): bool => str_contains(json_encode($request->data(), JSON_UNESCAPED_UNICODE), 'Sáu năm kinh nghiệm NestJS'));
    }

    public function test_it_returns_a_draft_and_creates_no_chat_message(): void
    {
        Http::fake(['api.anthropic.com/*' => Http::response(['content' => [['text' => 'Dạ giá 100k ạ']]])]);
        $this->account();
        $before = ChatMessage::query()->count();

        $response = $this->actingAs($this->admin())->postJson(route('chat.suggest', $this->conversation))->assertOk()->assertExactJson(['draft' => 'Dạ giá 100k ạ']);

        $this->assertSame($before, ChatMessage::query()->count());
        $this->assertStringNotContainsString(self::SECRET, $response->getContent());
    }

    public function test_it_needs_conversations_reply(): void
    {
        $this->account();
        $viewOnly = Admin::factory()->create(['system_admin' => false]);
        $viewOnly->givePermissionTo(Permission::findOrCreate('conversations.view', 'web'));

        $this->actingAs($viewOnly)->postJson(route('chat.suggest', $this->conversation))->assertForbidden();

        $replier = Admin::factory()->create(['system_admin' => false]);
        $replier->givePermissionTo(Permission::findOrCreate('conversations.reply', 'web'));
        Http::fake(['api.anthropic.com/*' => Http::response(['content' => [['text' => 'ok']]])]);

        $this->actingAs($replier)->postJson(route('chat.suggest', $this->conversation))->assertOk();
    }

    public function test_an_ai_failure_is_a_422_with_a_fixed_message_and_no_secret_in_response_or_log(): void
    {
        Log::spy();
        Http::fake(['api.anthropic.com/*' => Http::response(['error' => self::SECRET], 401)]);
        $this->account();

        $response = $this->actingAs($this->admin())->postJson(route('chat.suggest', $this->conversation))->assertStatus(422)->assertExactJson(['message' => AiException::UNAUTHORIZED]);

        $this->assertStringNotContainsString(self::SECRET, $response->getContent());
        Log::shouldNotHaveReceived('error');
    }

    public function test_without_any_account_it_says_not_configured(): void
    {
        $this->actingAs($this->admin())->postJson(route('chat.suggest', $this->conversation))->assertStatus(422)->assertExactJson(['message' => AiException::NOT_CONFIGURED]);
    }

    public function test_ai_routes_need_ai_use(): void
    {
        $plain = Admin::factory()->create(['system_admin' => false]);

        $this->actingAs($plain)->postJson(route('ai.ask'), ['question' => 'hi'])->assertForbidden();
        $this->postJson(route('ai.post-draft'), ['idea' => 'x'])->assertForbidden();

        $plain->givePermissionTo(Permission::findOrCreate('ai.use', 'web'));
        Http::fake(['api.anthropic.com/*' => Http::response(['content' => [['text' => 'hello']]])]);
        $this->account();

        $this->postJson(route('ai.ask'), ['question' => 'hi'])->assertOk()->assertExactJson(['answer' => 'hello']);
        $this->postJson(route('ai.post-draft'), ['idea' => 'ra mắt', 'platform' => 'linkedin'])->assertOk()->assertExactJson(['title' => null, 'draft' => 'hello']);
        $this->postJson(route('ai.post-draft'), ['idea' => 'ra mắt', 'platform' => 'nope'])->assertStatus(422);
        $this->assertSame(0, ChatMessage::query()->where('sender_type', 'staff')->count());
    }
}
