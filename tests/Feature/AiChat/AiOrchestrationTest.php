<?php

declare(strict_types=1);

namespace Tests\Feature\AiChat;

use App\Services\Ai\ChatActivity;
use App\Services\Ai\CliLlmClient;
use Illuminate\Support\Facades\Process;
use Tests\Feature\Ai\AiTestCase;

class AiOrchestrationTest extends AiTestCase
{
    public function test_a_big_job_is_split_into_agents_and_merged(): void
    {
        $events = [];
        $activity = app(ChatActivity::class);
        $activity->listenPlan(fn (array $todos) => null);
        $activity->listenAgents(function (array $event) use (&$events): void {
            $events[] = $event;
        });

        $plan = json_encode(['agents' => [
            ['role' => 'coder', 'task' => 'Sửa docs'],
            ['role' => 'reviewer', 'task' => 'Xem lại docs'],
        ]], JSON_THROW_ON_ERROR);
        $agentLine = fn (string $text): string => json_encode(['type' => 'result', 'result' => $text], JSON_THROW_ON_ERROR);

        Process::fake(['*' => Process::sequence()
            ->push(Process::result($plan))
            ->push(Process::result($agentLine('đã sửa')))
            ->push(Process::result($agentLine('đã xem')))
            ->push(Process::result('CÂU TRẢ LỜI CUỐI')),
        ]);

        $answer = (new CliLlmClient('anthropic', null))->complete('s', 'p');

        $this->assertSame('CÂU TRẢ LỜI CUỐI', $answer);

        $started = array_values(array_filter($events, fn (array $event): bool => isset($event['role'])));

        $this->assertSame(['coder', 'reviewer'], array_column($started, 'role'));
        $this->assertSame(['agent-1', 'agent-2'], array_column($started, 'id'));
        $this->assertContains('done', array_column($events, 'status'));
    }

    public function test_an_ordinary_answer_is_returned_as_is(): void
    {
        $activity = app(ChatActivity::class);
        $activity->listenPlan(fn (array $todos) => null);

        Process::fake(['*' => Process::result('Xin chào')]);

        $this->assertSame('Xin chào', (new CliLlmClient('anthropic', null))->complete('s', 'p'));
        Process::assertRanTimes(fn ($process): bool => true, 1);
    }
}
