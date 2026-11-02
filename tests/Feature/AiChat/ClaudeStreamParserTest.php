<?php

declare(strict_types=1);

namespace Tests\Feature\AiChat;

use App\Services\Ai\ChatActivity;
use App\Services\Ai\ClaudeStreamParser;
use PHPUnit\Framework\TestCase;

final class ClaudeStreamParserTest extends TestCase
{
    public function test_reports_subagents_steps_and_final_answer(): void
    {
        $events = [];
        $activity = new ChatActivity;
        $activity->listenAgents(function (array $event) use (&$events): void {
            $events[] = $event;
        });
        $parser = new ClaudeStreamParser($activity);

        $lines = [
            ['type' => 'assistant', 'parent_tool_use_id' => null, 'message' => ['content' => [['type' => 'tool_use', 'id' => 't1', 'name' => 'Task', 'input' => ['subagent_type' => 'coder', 'description' => 'Sửa docs', 'prompt' => 'secret']]]]],
            ['type' => 'assistant', 'parent_tool_use_id' => 't1', 'message' => ['content' => [['type' => 'tool_use', 'id' => 't2', 'name' => 'Read', 'input' => ['file_path' => '.agents/rules/docs.md']]]]],
            ['type' => 'user', 'parent_tool_use_id' => null, 'message' => ['content' => [['type' => 'tool_result', 'tool_use_id' => 't1']]]],
            ['type' => 'result', 'result' => 'Xong rồi'],
        ];
        $stream = implode("\n", array_map('json_encode', $lines));

        // * Split mid-line to prove chunks are buffered.
        $parser->feed(substr($stream, 0, 50));
        $parser->feed(substr($stream, 50));

        $this->assertSame('Xong rồi', $parser->result());
        $this->assertSame(['running', 'running', 'done'], array_column($events, 'status'));
        $this->assertSame('coder', $events[0]['role']);
        $this->assertNull($events[0]['parent']);
        $this->assertSame('Read .agents/rules/docs.md', $events[1]['step']);
        $this->assertStringNotContainsString('secret', json_encode($events, JSON_THROW_ON_ERROR));
    }

    public function test_plain_text_output_gives_no_result(): void
    {
        $parser = new ClaudeStreamParser(new ChatActivity);
        $parser->feed("just text\n");

        $this->assertNull($parser->result());
    }

    public function test_todo_write_becomes_the_plan(): void
    {
        $plans = [];
        $activity = new ChatActivity;
        $activity->listenPlan(function (array $todos) use (&$plans): void {
            $plans[] = $todos;
        });
        $parser = new ClaudeStreamParser($activity);

        $parser->feed(json_encode(['type' => 'assistant', 'message' => ['content' => [['type' => 'tool_use', 'id' => 'p1', 'name' => 'TodoWrite', 'input' => ['todos' => [
            ['content' => 'Đọc rule', 'status' => 'completed'],
            ['content' => 'Sửa docs', 'status' => 'bogus'],
        ]]]]]])."\n");

        $this->assertSame([['content' => 'Đọc rule', 'status' => 'completed'], ['content' => 'Sửa docs', 'status' => 'pending']], $plans[0]);
    }

    public function test_files_a_subagent_edited_are_listed_when_it_finishes(): void
    {
        $events = [];
        $activity = new ChatActivity;
        $activity->listenAgents(function (array $event) use (&$events): void {
            $events[] = $event;
        });
        $parser = new ClaudeStreamParser($activity);

        $lines = [
            ['type' => 'assistant', 'parent_tool_use_id' => null, 'message' => ['content' => [['type' => 'tool_use', 'id' => 't1', 'name' => 'Task', 'input' => ['subagent_type' => 'coder', 'description' => 'TASK-2']]]]],
            ['type' => 'assistant', 'parent_tool_use_id' => 't1', 'message' => ['content' => [['type' => 'tool_use', 'id' => 't2', 'name' => 'Edit', 'input' => ['file_path' => 'a.md']], ['type' => 'tool_use', 'id' => 't3', 'name' => 'Edit', 'input' => ['file_path' => 'a.md']], ['type' => 'tool_use', 'id' => 't4', 'name' => 'Read', 'input' => ['file_path' => 'b.md']]]]],
            ['type' => 'user', 'parent_tool_use_id' => null, 'message' => ['content' => [['type' => 'tool_result', 'tool_use_id' => 't1']]]],
        ];
        $parser->feed(implode("\n", array_map('json_encode', $lines))."\n");

        $this->assertSame(['a.md'], end($events)['files']);
        $this->assertSame('done', end($events)['status']);
    }
}
