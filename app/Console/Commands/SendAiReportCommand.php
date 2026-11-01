<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Conversation;
use App\Models\Integration;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Ai\ReportBuilder;
use App\Services\Chat\ChatChannels;
use App\Services\Chat\Telegram\ChatUnavailableException;
use App\Support\PersonalClock;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * * Sends yesterday's report (numbers from `ReportBuilder`, wording from the AI) to the conversation chosen as `report_conversation_id`
 * * on the `ai` integration. It sends through the normal chat sender of that conversation's channel; the conversation must already exist.
 * * The client token is per day, so running the command twice in one day cannot send the report twice.
 */
class SendAiReportCommand extends Command
{
    protected $signature = 'ai:send-report';

    protected $description = 'Send the daily activity report to the configured chat conversation';

    public function handle(ReportBuilder $builder, AiAssistant $assistant, ChatChannels $channels): int
    {
        $integration = Integration::query()->where('provider', AiAssistant::PROVIDER)->first();
        $conversationId = $integration->settings['fields']['report_conversation_id'] ?? null;

        if (blank($conversationId)) {
            $this->info('No report conversation configured; nothing sent.');

            return self::SUCCESS;
        }

        $conversation = Str::isUuid((string) $conversationId) ? Conversation::query()->find((string) $conversationId) : null;

        if ($conversation === null) {
            $this->error('The configured report conversation does not exist.');

            return self::FAILURE;
        }

        $day = PersonalClock::today()->subDay();
        $report = $builder->forDay($day);
        $text = $builder->format($report);

        // * The AI only adds a summary; without it the numbers alone are still sent.
        try {
            $text .= "\n\n".$assistant->summarizeReport($report);
        } catch (AiException) {
            $this->warn('AI summary unavailable; sending the numbers only.');
        }

        try {
            $channels->sender($conversation->provider)->send($conversation, Str::limit($text, 4000, ''), 'ai-report-'.$day->format('Ymd'), 'Trợ lý AI');
        } catch (ChatUnavailableException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->info('Report sent.');

        return self::SUCCESS;
    }
}
