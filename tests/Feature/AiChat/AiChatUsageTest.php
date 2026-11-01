<?php

declare(strict_types=1);

namespace Tests\Feature\AiChat;

use App\Models\Admin;
use App\Models\AiConversation;
use App\Models\AiMessage;
use App\Models\AiUsageLog;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\Feature\Ai\AiTestCase;

class AiChatUsageTest extends AiTestCase
{
    private function complete(string $purpose = 'ask'): void
    {
        $this->app->make(AiAssistant::class)->complete($purpose, 'system SECRET-PROMPT', 'prompt SECRET-PROMPT');
    }

    public function test_every_call_is_logged_with_its_outcome_and_never_its_content(): void
    {
        $admin = $this->admin();
        $account = $this->account(['status' => 'connected', 'model' => 'claude-haiku-4-5']);
        Http::fake(['api.anthropic.com/*' => Http::sequence()
            ->push(['content' => [['text' => 'ANSWER-TEXT']]])
            ->push(['error' => ['message' => 'VENDOR-DETAIL '.self::SECRET]], 500)
            ->push(['error' => ['type' => 'rate_limit_error', 'message' => 'VENDOR-DETAIL']], 400)]);
        $this->actingAs($admin);

        $this->complete();
        try {
            $this->complete('report');
        } catch (AiException) {
        }
        try {
            $this->complete('post_draft');
        } catch (AiException) {
        }

        $rows = AiUsageLog::query()->orderBy('id')->get();
        $this->assertSame(['ok', 'error', 'quota'], $rows->pluck('status')->all());
        $this->assertSame([null, 'failed', 'quota'], $rows->pluck('error_kind')->all());
        $this->assertSame(['ask', 'report', 'post_draft'], $rows->pluck('purpose')->all());
        $this->assertSame($account->id, $rows[0]->ai_account_id);
        $this->assertSame($admin->id, $rows[0]->user_id);
        $this->assertSame('claude-haiku-4-5', $rows[0]->model);

        $dump = json_encode(AiUsageLog::query()->get()->toArray());
        foreach (['SECRET-PROMPT', 'ANSWER-TEXT', 'VENDOR-DETAIL', self::SECRET] as $needle) {
            $this->assertStringNotContainsString($needle, (string) $dump);
        }
    }

    public function test_each_call_stores_estimated_token_counts_and_still_no_text(): void
    {
        $this->actingAs($this->admin());
        $this->account(['status' => 'connected']);
        Http::fake(['api.anthropic.com/*' => Http::sequence()
            ->push(['content' => [['text' => str_repeat('a', 40)]]])
            ->push(['error' => ['message' => 'x']], 500)]);

        $this->complete();
        try {
            $this->complete('report');
        } catch (AiException) {
        }

        $rows = AiUsageLog::query()->orderBy('id')->get();
        $this->assertGreaterThan(0, $rows[0]->tokens_in);
        $this->assertSame(10, $rows[0]->tokens_out);
        $this->assertGreaterThan(0, $rows[1]->tokens_in);
        $this->assertNull($rows[1]->tokens_out);
    }

    public function test_stats_sum_the_estimated_tokens_models_and_largest_request_of_the_own_calls(): void
    {
        $me = $this->admin();
        $other = $this->admin();
        $account = $this->account(['status' => 'connected']);

        $this->logAt($account->id, $me->id, 'ok', now()->subHours(2), 100, 50, 'm-a');
        $this->logAt($account->id, $me->id, 'ok', now()->subDays(3), 400, 100, 'm-b');
        $this->logAt($account->id, $me->id, 'ok', now()->subDays(4), 10, 10, 'm-b');
        $this->logAt($account->id, $me->id, 'ok', now()->subDays(9), 9000, 9000, 'm-old');
        $this->logAt($account->id, $other->id, 'ok', now()->subHour(), 7000, 7000, 'm-other');
        $this->logAt($account->id, $me->id, 'ok', now()->subHour());

        $row = $this->actingAs($me)->getJson(route('ai-chat.usage'))->assertOk()->json('accounts.0');

        $this->assertSame(150, $row['tokens_24h']);
        $this->assertSame(670, $row['tokens_7d']);
        $this->assertSame(400, $row['largest_request']);
        $this->assertSame(['m-b', 'm-a'], $row['models_used']);
        $this->assertSame(AiAssistant::CONTEXT_WINDOW_TOKENS, $row['context_window']);
    }

    public function test_quota_is_classified_only_from_real_signals(): void
    {
        $this->account(['status' => 'connected']);

        Http::fake(['api.anthropic.com/*' => Http::sequence()
            ->push([], 429)
            ->push([], 402)
            ->push(['error' => ['code' => 'insufficient_quota']], 400)
            ->push(['error' => ['message' => 'rate limit in text only']], 500)]);

        foreach (range(1, 3) as $ignored) {
            $this->expectQuota();
        }

        // * A message that only mentions a limit in its text is a plain error.
        try {
            $this->complete();
        } catch (AiException $exception) {
            $this->assertSame(AiException::FAILED, $exception->getMessage());
        }
        $this->assertSame('error', AiUsageLog::query()->latest('id')->value('status'));
    }

    private function logAt(int $accountId, int $userId, string $status, \DateTimeInterface $at, ?int $tokensIn = null, ?int $tokensOut = null, ?string $model = null): void
    {
        (new AiUsageLog)->forceFill(['ai_account_id' => $accountId, 'user_id' => $userId, 'purpose' => 'ask', 'model' => $model, 'status' => $status, 'error_kind' => $status === 'ok' ? null : $status, 'tokens_in' => $tokensIn, 'tokens_out' => $tokensOut, 'created_at' => $at])->save();
    }

    private function expectQuota(): void
    {
        try {
            $this->complete();
            $this->fail('A quota error was expected.');
        } catch (AiException $exception) {
            $this->assertSame(AiException::QUOTA, $exception->getMessage());
        }

        $this->assertSame('quota', AiUsageLog::query()->latest('id')->value('status'));
    }

    public function test_stats_count_24_hours_and_7_days_of_the_own_calls_and_report_the_status(): void
    {
        $me = $this->admin();
        $other = $this->admin();
        $account = $this->account(['status' => 'connected', 'model' => 'claude-haiku-4-5']);
        $idle = $this->account(['name' => 'Idle']);
        $log = fn (array $attributes) => $this->logAt($attributes['account_id'] ?? $account->id, $attributes['user_id'] ?? $me->id, $attributes['status'] ?? 'ok', $attributes['created_at']);

        $log(['created_at' => now()->subHours(2)]);
        $log(['created_at' => now()->subHours(30)]);
        $log(['created_at' => now()->subDays(6)]);
        $log(['created_at' => now()->subDays(9)]);
        $log(['user_id' => $other->id, 'created_at' => now()->subHour()]);
        $log(['status' => 'quota', 'created_at' => now()->subMinutes(5)]);

        $response = $this->actingAs($me)->getJson(route('ai-chat.usage'))->assertOk();
        $rows = collect($response->json('accounts'))->keyBy('id');

        $this->assertTrue($response->json('available'));
        $this->assertSame(4, $rows[$account->id]['calls_7d']);
        $this->assertSame(2, $rows[$account->id]['calls_24h']);
        $this->assertSame('quota', $rows[$account->id]['status']);
        $this->assertNotNull($rows[$account->id]['status_at']);
        $this->assertSame('unused', $rows[$idle->id]['status']);
        $this->assertSame(0, $rows[$idle->id]['calls_7d']);
        $this->assertSame('claude-haiku-4-5', $rows[$account->id]['model']);
        $this->assertArrayNotHasKey('credentials', $rows[$account->id]);
        $this->assertStringNotContainsString(self::SECRET, (string) $response->getContent());
    }

    public function test_the_quota_status_clears_once_a_later_call_succeeds(): void
    {
        $me = $this->admin();
        $account = $this->account(['status' => 'connected']);
        $this->logAt($account->id, $me->id, 'quota', now()->subHour());
        $this->logAt($account->id, $me->id, 'ok', now()->subMinutes(10));

        $this->actingAs($me)->getJson(route('ai-chat.usage'))->assertJsonPath('accounts.0.status', 'active');

        Cache::flush();
        $this->logAt($account->id, $me->id, 'error', now()->subMinute());
        $this->actingAs($me)->getJson(route('ai-chat.usage'))->assertJsonPath('accounts.0.status', 'error');
    }

    public function test_stats_need_ai_use_and_use_a_fixed_number_of_queries(): void
    {
        $me = $this->admin();
        foreach (range(1, 6) as $n) {
            $account = $this->account(['name' => "A{$n}"]);
            AiUsageLog::query()->create(['ai_account_id' => $account->id, 'user_id' => $me->id, 'purpose' => 'ask', 'status' => 'ok']);
        }

        DB::enableQueryLog();
        $this->actingAs($me)->getJson(route('ai-chat.usage'))->assertOk();
        $selects = collect(DB::getQueryLog())->filter(fn (array $query): bool => str_contains($query['query'], 'ai_usage_logs') || str_contains($query['query'], 'ai_accounts'))->count();
        $this->assertLessThanOrEqual(5, $selects);

        $plain = Admin::factory()->create(['system_admin' => false]);
        $this->actingAs($plain)->getJson(route('ai-chat.usage'))->assertForbidden();
    }

    public function test_a_missing_table_gives_no_data_instead_of_an_error(): void
    {
        $me = $this->admin();
        $this->account(['status' => 'connected']);
        Schema::drop('ai_usage_logs');
        Http::fake(['api.anthropic.com/*' => Http::response(['content' => [['text' => 'ok']]])]);

        $this->actingAs($me)->getJson(route('ai-chat.usage'))->assertOk()->assertJson(['available' => false, 'accounts' => []]);

        // * A call still works without the log table.
        $this->complete();
        $this->assertTrue(true);
    }

    public function test_existing_chat_history_is_counted_in_the_fallback_totals(): void
    {
        $me = $this->admin();
        $other = $this->admin();
        $this->account(['status' => 'connected']);
        $mine = AiConversation::query()->create(['user_id' => $me->id, 'title' => 'x']);
        $theirs = AiConversation::query()->create(['user_id' => $other->id, 'title' => 'y']);
        $reply = fn (AiConversation $conversation, string $role, \DateTimeInterface $at) => (new AiMessage)->forceFill(['ai_conversation_id' => $conversation->id, 'role' => $role, 'content' => 'SECRET-CONTENT', 'created_at' => $at, 'updated_at' => $at])->save();
        $reply($mine, 'assistant', now()->subHours(3));
        $reply($mine, 'assistant', now()->subDays(3));
        $reply($mine, 'assistant', now()->subDays(10));
        $reply($mine, 'user', now()->subHour());
        $reply($theirs, 'assistant', now()->subHour());

        $response = $this->actingAs($me)->getJson(route('ai-chat.usage'))->assertOk();

        $this->assertSame(['replies_24h' => 1, 'replies_7d' => 2], $response->json('history'));
        $this->assertStringNotContainsString('SECRET-CONTENT', (string) $response->getContent());
    }
}
