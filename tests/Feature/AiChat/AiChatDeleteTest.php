<?php

declare(strict_types=1);

namespace Tests\Feature\AiChat;

use App\Models\AiConversation;
use App\Models\AiMessage;
use Tests\Feature\Ai\AiTestCase;

class AiChatDeleteTest extends AiTestCase
{
    private function thread(int $userId, ?string $repo = null): AiConversation
    {
        $conversation = AiConversation::query()->create(['user_id' => $userId, 'title' => 'T', 'repo' => $repo]);
        $conversation->messages()->create(['role' => AiMessage::ROLE_USER, 'content' => 'hi']);

        return $conversation;
    }

    public function test_one_thread_is_deleted_with_its_messages(): void
    {
        $admin = $this->admin();
        $mine = $this->thread($admin->id);
        $other = $this->thread($this->admin()->id);

        $this->actingAs($admin)->delete("/ai-chat/conversations/{$mine->uuid}")->assertRedirect('/');
        $this->assertNull(AiConversation::query()->find($mine->id));
        $this->assertSame(0, AiMessage::query()->where('ai_conversation_id', $mine->id)->count());

        $this->actingAs($admin)->delete("/ai-chat/conversations/{$other->uuid}")->assertNotFound();
        $this->assertNotNull(AiConversation::query()->find($other->id));
    }

    public function test_delete_all_clears_only_the_chosen_list_of_the_own_admin(): void
    {
        $admin = $this->admin();
        $chat = $this->thread($admin->id);
        $code = $this->thread($admin->id, 'owner/repo');
        $other = $this->thread($this->admin()->id);

        $this->actingAs($admin)->delete('/ai-chat/conversations?scope=chat')->assertRedirect('/');

        $this->assertNull(AiConversation::query()->find($chat->id));
        $this->assertNotNull(AiConversation::query()->find($code->id));
        $this->assertNotNull(AiConversation::query()->find($other->id));
        $this->assertSame(0, AiMessage::query()->where('ai_conversation_id', $chat->id)->count());
    }

    public function test_delete_by_project_clears_only_that_projects_threads(): void
    {
        $admin = $this->admin();
        $a = $this->thread($admin->id, 'owner/a');
        $b = $this->thread($admin->id, 'owner/b');

        $this->actingAs($admin)->delete('/ai-chat/conversations', ['scope' => 'repo', 'repo' => 'owner/a'])->assertRedirect('/');

        $this->assertNull(AiConversation::query()->find($a->id));
        $this->assertNotNull(AiConversation::query()->find($b->id));
        $this->actingAs($admin)->delete('/ai-chat/conversations', ['scope' => 'repo'])->assertSessionHasErrors('repo');
    }
}
