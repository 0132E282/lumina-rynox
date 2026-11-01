<?php

declare(strict_types=1);

namespace Tests\Feature\Ai;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\Post;
use App\Services\Ai\ReportBuilder;
use App\Services\Chat\ChatChannelDriver;
use App\Services\Chat\ChatChannels;
use App\Services\Chat\ChatSender;
use App\Services\Chat\Telegram\ChatUnavailableException;
use App\Support\PersonalClock;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;

class SendReportTest extends AiTestCase
{
    /** @var list<array{string, string}> */
    public static array $sent = [];

    public static bool $fail = false;

    private Conversation $target;

    protected function setUp(): void
    {
        parent::setUp();

        self::$sent = [];
        self::$fail = false;
        app()->afterResolving(ChatChannels::class, fn (ChatChannels $channels) => $channels->register(new class implements ChatChannelDriver
        {
            public function provider(): string
            {
                return 'fake';
            }

            public function label(): string
            {
                return 'Fake';
            }

            public function sender(): ChatSender
            {
                return new class implements ChatSender
                {
                    public function ensureCanSend(Conversation $conversation): Integration
                    {
                        return new Integration;
                    }

                    public function send(Conversation $conversation, string $body, string $clientToken, ?string $staffName): ChatMessage
                    {
                        if (SendReportTest::$fail) {
                            throw new ChatUnavailableException('Kênh đang mất kết nối.');
                        }

                        SendReportTest::$sent[] = [$clientToken, $body];

                        return new ChatMessage;
                    }

                    public function sendAttachment(Conversation $conversation, UploadedFile $file, string $caption, string $clientToken, ?string $staffName): ChatMessage
                    {
                        throw new \LogicException('Not used.');
                    }

                    public function resend(ChatMessage $message): ?ChatMessage
                    {
                        return null;
                    }
                };
            }

            public function presentChannel(?Integration $integration): array
            {
                return ['display_name' => null, 'account' => null, 'account_count' => 0, 'can_send' => true];
            }

            public function conversationRelations(): array
            {
                return [];
            }

            public function presentConversation(Conversation $conversation): array
            {
                return [];
            }
        }));

        $this->target = Conversation::query()->create(['provider' => 'fake', 'external_chat_id' => 'r', 'type' => 'private', 'title' => 'Báo cáo']);
    }

    private function configureReport(?string $conversationId): void
    {
        Integration::query()->create(['provider' => 'ai', 'status' => 'connected', 'settings' => ['fields' => ['report_conversation_id' => $conversationId === null ? null : (string) $conversationId]]]);
    }

    public function test_report_numbers_are_counted_per_channel_for_the_day(): void
    {
        $yesterday = PersonalClock::today()->subDay()->addHours(10);
        $telegram = Conversation::query()->create(['provider' => 'telegram', 'external_chat_id' => 't', 'type' => 'private', 'title' => 'T', 'unread_count' => 2]);

        foreach ([['in', $yesterday], ['in', $yesterday], ['out', $yesterday], ['in', $yesterday->subDays(3)]] as [$direction, $at]) {
            ChatMessage::query()->create(['conversation_id' => $telegram->id, 'direction' => $direction, 'sender_type' => 'customer', 'body' => 'x', 'sent_at' => $at]);
        }

        // * Status is not fillable (system-owned), so it is written directly like the app does.
        $scheduled = Post::query()->create(['body' => 'a', 'scheduled_at' => $yesterday]);
        Post::query()->whereKey($scheduled->id)->update(['status' => Post::STATUS_SCHEDULED]);
        $failed = Post::query()->create(['body' => 'b']);
        Post::query()->whereKey($failed->id)->update(['status' => Post::STATUS_FAILED, 'updated_at' => now()->subDays(5)]);

        $report = app(ReportBuilder::class)->forDay(PersonalClock::today()->subDay());

        $this->assertSame(['telegram' => ['in' => 2, 'out' => 1]], $report['messages']);
        $this->assertSame(1, $report['unread_conversations']);
        $this->assertSame(1, $report['posts']['scheduled']);
        $this->assertSame(0, $report['posts']['failed']);
        $this->assertStringContainsString('2 vào, 1 ra', app(ReportBuilder::class)->format($report));
    }

    public function test_the_command_sends_numbers_and_ai_summary_through_the_channel_sender(): void
    {
        Http::fake(['api.anthropic.com/*' => Http::response(['content' => [['text' => 'Tóm tắt AI']]])]);
        $this->account();
        $this->configureReport($this->target->id);

        $this->artisan('ai:send-report')->assertSuccessful();

        $this->assertCount(1, self::$sent);
        [$token, $body] = self::$sent[0];
        $this->assertSame('ai-report-'.PersonalClock::today()->subDay()->format('Ymd'), $token);
        $this->assertStringContainsString('Hội thoại chưa đọc', $body);
        $this->assertStringContainsString('Tóm tắt AI', $body);
        $this->assertStringNotContainsString(self::SECRET, $body);
    }

    public function test_the_numbers_alone_are_sent_when_the_ai_is_down(): void
    {
        Http::fake(['*' => Http::response([], 500)]);
        $this->account();
        $this->configureReport($this->target->id);

        $this->artisan('ai:send-report')->assertSuccessful();

        $this->assertCount(1, self::$sent);
        $this->assertStringContainsString('Báo cáo ngày', self::$sent[0][1]);
    }

    public function test_nothing_is_sent_without_a_report_conversation_or_when_it_is_missing(): void
    {
        $this->artisan('ai:send-report')->assertSuccessful();
        $this->configureReport(null);
        $this->artisan('ai:send-report')->assertSuccessful();
        Integration::query()->where('provider', 'ai')->delete();
        $this->configureReport('0198a1b2-0000-7000-8000-000000000000');
        $this->artisan('ai:send-report')->assertFailed();

        $this->assertSame([], self::$sent);
    }

    public function test_a_sender_failure_fails_the_command_with_the_sender_message(): void
    {
        $this->account();
        $this->configureReport($this->target->id);
        self::$fail = true;

        $this->artisan('ai:send-report')->expectsOutputToContain('Kênh đang mất kết nối.')->assertFailed();
    }

    public function test_the_report_is_scheduled_daily_at_eight_without_overlap(): void
    {
        $event = collect(app(Schedule::class)->events())->first(fn ($event): bool => str_contains((string) $event->command, 'ai:send-report'));

        $this->assertNotNull($event);
        $this->assertSame('0 8 * * *', $event->expression);
        $this->assertTrue($event->withoutOverlapping);
        $this->assertSame(config('cms.personal_timezone'), (string) $event->timezone);
    }
}
