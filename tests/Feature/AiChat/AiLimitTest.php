<?php

declare(strict_types=1);

namespace Tests\Feature\AiChat;

use App\Models\AiAccount;
use App\Models\AiUsageLog;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Ai\QuotaLimit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Tests\Feature\Ai\AiTestCase;

class AiLimitTest extends AiTestCase
{
    private Carbon $now;

    protected function setUp(): void
    {
        parent::setUp();

        $this->now = Carbon::parse('2026-11-01 10:00:00', 'UTC');
        Carbon::setTestNow($this->now);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    private function parse(string $text, ?string $retryAfter = null): QuotaLimit
    {
        return QuotaLimit::parse($text, $retryAfter, $this->now->copy());
    }

    public function test_claude_cli_texts_give_scope_and_reset(): void
    {
        $session = $this->parse('5-hour limit reached ∙ resets 3pm');
        $this->assertSame('day', $session->scope);
        $this->assertSame('2026-11-01 15:00:00', $session->resetAt?->format('Y-m-d H:i:s'));

        $tomorrow = QuotaLimit::parse('5-hour limit reached ∙ resets 9am', null, $this->now->copy());
        $this->assertSame('2026-11-02 09:00:00', $tomorrow->resetAt?->format('Y-m-d H:i:s'));

        $weekly = $this->parse('Weekly limit reached ∙ resets Nov 8, 3pm');
        $this->assertSame('week', $weekly->scope);
        $this->assertSame('2026-11-08 15:00:00', $weekly->resetAt?->format('Y-m-d H:i:s'));

        $epoch = $this->parse('Claude AI usage limit reached|'.($this->now->timestamp + 3600));
        $this->assertSame('2026-11-01 11:00:00', $epoch->resetAt?->format('Y-m-d H:i:s'));

        $zone = $this->parse('5-hour limit reached ∙ resets 3pm (Asia/Ho_Chi_Minh)');
        $this->assertSame('2026-11-02 08:00:00', $zone->resetAt?->utc()->format('Y-m-d H:i:s'));
    }

    public function test_codex_cli_texts_give_scope_and_reset(): void
    {
        $relative = $this->parse("You've hit your usage limit. Try again in 2 hours 30 minutes.");
        $this->assertNull($relative->scope);
        $this->assertSame('2026-11-01 12:30:00', $relative->resetAt?->format('Y-m-d H:i:s'));

        $days = $this->parse('weekly usage limit reached, try again in 5 days 3 hours 2 minutes');
        $this->assertSame('week', $days->scope);
        $this->assertSame('2026-11-06 13:02:00', $days->resetAt?->format('Y-m-d H:i:s'));

        $absolute = $this->parse("You've hit your usage limit. Try again at Nov 8th, 2026 3:15 PM.");
        $this->assertSame('2026-11-08 15:15:00', $absolute->resetAt?->format('Y-m-d H:i:s'));
    }

    public function test_api_retry_after_seconds_or_http_date(): void
    {
        $seconds = $this->parse('Rate limit exceeded for requests per day', '120');
        $this->assertSame('day', $seconds->scope);
        $this->assertSame('2026-11-01 10:02:00', $seconds->resetAt?->format('Y-m-d H:i:s'));

        $date = $this->parse('', 'Sun, 01 Nov 2026 12:00:00 GMT');
        $this->assertNull($date->scope);
        $this->assertSame('2026-11-01 12:00:00', $date->resetAt?->format('Y-m-d H:i:s'));
    }

    public function test_garbage_gives_null_and_implausible_times_are_dropped(): void
    {
        foreach (['', 'something broke', 'resets someday', 'resets 99pm', 'resets Feb 31', 'try again in banana', '<script>alert(1)</script> resets'] as $text) {
            $limit = $this->parse($text);
            $this->assertNull($limit->resetAt, $text);
            $this->assertNull($limit->scope, $text);
        }

        $this->assertNull($this->parse('limit', '99999999')->resetAt);
        $this->assertNull($this->parse('limit', 'not-a-number')->resetAt);
        $this->assertNull($this->parse('resets Nov 1, 2020')->resetAt);
    }

    public function test_an_api_429_stores_only_scope_and_reset_never_the_text(): void
    {
        $admin = $this->admin();
        $account = $this->account(['status' => 'connected']);
        Http::fake(['api.anthropic.com/*' => Http::response(['error' => ['type' => 'rate_limit_error', 'message' => 'RAW-VENDOR-TEXT daily limit '.self::SECRET]], 429, ['Retry-After' => '90'])]);
        $this->actingAs($admin);

        try {
            app(AiAssistant::class)->complete('ask', 'sys', 'prompt');
            $this->fail('A quota error was expected.');
        } catch (AiException $exception) {
            $this->assertSame(AiException::QUOTA, $exception->getMessage());
        }

        $row = AiUsageLog::query()->firstOrFail();
        $this->assertSame('quota', $row->status);
        $this->assertSame('day', $row->limit_scope);
        $this->assertSame('2026-11-01 10:01:30', $row->limit_reset_at?->format('Y-m-d H:i:s'));
        $dump = (string) json_encode(AiUsageLog::query()->get()->toArray());
        $this->assertStringNotContainsString('RAW-VENDOR-TEXT', $dump);
        $this->assertStringNotContainsString(self::SECRET, $dump);

        $limit = $this->actingAs($admin)->getJson(route('ai-chat.usage'))->assertOk()->json('accounts.0.limit');
        $this->assertSame(['state' => 'limited', 'scope' => 'day', 'reset_at' => '2026-11-01T10:01:30+00:00'], $limit);
        $this->assertSame($account->id, $this->actingAs($admin)->getJson(route('ai-chat.usage'))->json('accounts.0.id'));
    }

    public function test_a_cli_limit_is_logged_with_scope_and_reset(): void
    {
        Http::fake();
        Process::fake(['*' => Process::result('', 'Weekly limit reached ∙ resets Nov 8, 3pm', 1)]);
        AiAccount::query()->create(['name' => 'CLI', 'vendor' => 'anthropic', 'auth_type' => AiAccount::AUTH_SESSION, 'credentials' => null, 'priority' => 0, 'enabled' => true, 'status' => 'connected']);

        try {
            app(AiAssistant::class)->complete('ask', 'sys', 'prompt');
            $this->fail('A quota error was expected.');
        } catch (AiException) {
        }

        $row = AiUsageLog::query()->firstOrFail();
        $this->assertSame('week', $row->limit_scope);
        $this->assertSame('2026-11-08 15:00:00', $row->limit_reset_at?->format('Y-m-d H:i:s'));
        $this->assertStringNotContainsString('Weekly', (string) json_encode($row->toArray()));
    }

    public function test_the_state_clears_after_a_later_success_or_a_past_reset(): void
    {
        $me = $this->admin();
        $account = $this->account(['status' => 'connected']);
        $log = fn (string $status, Carbon $at, ?Carbon $reset = null) => (new AiUsageLog)->forceFill(['ai_account_id' => $account->id, 'user_id' => $me->id, 'purpose' => 'ask', 'status' => $status, 'limit_scope' => $status === 'quota' ? 'week' : null, 'limit_reset_at' => $reset, 'created_at' => $at])->save();
        $limit = fn (): array => $this->actingAs($me)->getJson(route('ai-chat.usage'))->json('accounts.0.limit');

        $log('quota', $this->now->copy()->subHour(), $this->now->copy()->addDay());
        $this->assertSame('limited', $limit()['state']);

        // * A success after the stop clears it.
        Cache::flush();
        $log('ok', $this->now->copy()->subMinutes(5));
        $this->assertSame(['state' => 'ok', 'scope' => null, 'reset_at' => null], $limit());

        // * A newer stop whose reset time already passed is not a limit any more.
        Cache::flush();
        $log('quota', $this->now->copy()->subMinute(), $this->now->copy()->subSeconds(10));
        $this->assertSame('ok', $limit()['state']);

        // * An unknown reset time stays limited (until a success).
        Cache::flush();
        $log('quota', $this->now->copy()->subSeconds(30));
        $this->assertSame(['state' => 'limited', 'scope' => 'week', 'reset_at' => null], $limit());
    }

    public function test_the_accounts_page_carries_the_limit_and_it_is_account_wide_while_counts_stay_own(): void
    {
        $me = $this->admin();
        $other = $this->admin();
        $account = $this->account(['status' => 'connected']);
        (new AiUsageLog)->forceFill(['ai_account_id' => $account->id, 'user_id' => $other->id, 'purpose' => 'ask', 'status' => 'quota', 'limit_scope' => 'day', 'limit_reset_at' => $this->now->copy()->addHour(), 'created_at' => $this->now->copy()->subMinute()])->save();

        $page = $this->actingAs($me)->get(route('integrations.show', 'ai'))->assertOk()->viewData('page');
        $this->assertSame('limited', $page['props']['integration']['ai_accounts'][0]['limit']['state']);

        $row = $this->actingAs($me)->getJson(route('ai-chat.usage'))->json('accounts.0');
        $this->assertSame(0, $row['calls_7d']);
        $this->assertSame('day', $row['limit']['scope']);
    }
}
