<?php

declare(strict_types=1);

namespace App\Services\Ai;

/**
 * * Reads the `claude -p --output-format stream-json` lines as they arrive: the subagents Claude starts (the Task/Agent tool) are reported to ChatActivity, and the final answer text is kept.
 * ! Only the role, the short task, the tool name and a path/pattern are passed on; prompts and tool output never are.
 */
final class ClaudeStreamParser
{
    private const AGENT_TOOLS = ['Task', 'Agent'];

    private string $buffer = '';

    /** Tools whose target file counts as "edited" by the agent. */
    private const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

    private ?string $result = null;

    /** @var array<string, list<string>> files each agent edited (agent id => paths) */
    private array $files = [];

    /** @var array<string, true> ids of the subagents still running */
    private array $running = [];

    /** @param  string|null  $rootId  the agent this run belongs to: the subagents it starts hang under it, and its own result marks it done */
    public function __construct(private readonly ChatActivity $activity, private readonly ?string $rootId = null, private readonly ?string $base = null) {}

    public function feed(string $chunk): void
    {
        $this->buffer .= $chunk;

        while (($newline = strpos($this->buffer, "\n")) !== false) {
            $this->line(substr($this->buffer, 0, $newline));
            $this->buffer = substr($this->buffer, $newline + 1);
        }
    }

    /** The answer text of the `result` line, or null when the output was not stream-json. */
    public function result(): ?string
    {
        $this->line($this->buffer);
        $this->buffer = '';

        return $this->result;
    }

    private function line(string $line): void
    {
        $event = json_decode(trim($line), true);

        if (! is_array($event)) {
            return;
        }

        if (($event['type'] ?? null) === 'result' && is_string($event['result'] ?? null)) {
            $this->result = $event['result'];

            if ($this->rootId !== null) {
                $usage = is_array($event['usage'] ?? null) ? $event['usage'] : [];
                $tokens = (int) ($usage['input_tokens'] ?? 0) + (int) ($usage['output_tokens'] ?? 0)
                    + (int) ($usage['cache_creation_input_tokens'] ?? 0) + (int) ($usage['cache_read_input_tokens'] ?? 0);

                $this->activity->agent(['id' => $this->rootId, 'step' => 'Đã xong', 'status' => 'done'] + ($tokens > 0 ? ['tokens' => $tokens] : []) + (($this->files[$this->rootId] ?? []) !== [] ? ['files' => $this->files[$this->rootId]] : []));
            }

            return;
        }

        $parent = is_string($event['parent_tool_use_id'] ?? null) ? $event['parent_tool_use_id'] : null;
        $blocks = $event['message']['content'] ?? [];

        if (! is_array($blocks)) {
            return;
        }

        foreach ($blocks as $block) {
            if (! is_array($block)) {
                continue;
            }

            match ($block['type'] ?? null) {
                'tool_use' => $this->toolUse($block, $parent),
                'tool_result' => $this->toolResult($block),
                default => null,
            };
        }
    }

    /** @param array<string, mixed> $block */
    private function toolUse(array $block, ?string $parent): void
    {
        $id = is_string($block['id'] ?? null) ? $block['id'] : null;
        $name = is_string($block['name'] ?? null) ? $block['name'] : '';
        $input = is_array($block['input'] ?? null) ? $block['input'] : [];

        if ($name === 'TodoWrite' && is_array($input['todos'] ?? null)) {
            $this->activity->plan($this->todos($input['todos']));

            return;
        }

        if ($id !== null && in_array($name, self::AGENT_TOOLS, true)) {
            $this->running[$id] = true;
            $this->activity->agent([
                'id' => $id,
                'parent' => $parent ?? $this->rootId,
                'role' => $this->text($input['subagent_type'] ?? 'subagent', 60),
                'task' => $this->text($input['description'] ?? '', 160),
                'step' => '',
                'status' => 'running',
            ]);

            return;
        }

        // * A tool call made inside a subagent (or by the agent this run belongs to) is that one's current step.
        $owner = $parent ?? $this->rootId;

        if ($owner !== null && ($owner === $this->rootId || isset($this->running[$owner]))) {
            $target = $input['file_path'] ?? $input['path'] ?? $input['pattern'] ?? $input['command'] ?? '';
            // * Shown relative to the clone; the same path is compared and stored, so a file edited twice is listed once.
            $shown = is_string($target) ? $this->relative($target) : '';
            $edited = in_array($name, self::EDIT_TOOLS, true) && $shown !== ''
                && ! in_array($shown, $this->files[$owner] ?? [], true) && count($this->files[$owner] ?? []) < 50;

            if ($edited) {
                $this->files[$owner][] = $shown;
            }

            $this->activity->agent(['id' => $owner, 'step' => trim($name.' '.$this->text($target, 120)), 'status' => 'running'] + ($edited ? ['files' => $this->files[$owner]] : []));
        }
    }

    private function relative(string $path): string
    {
        return $this->text($this->base !== null && str_starts_with($path, $this->base.'/') ? substr($path, strlen($this->base) + 1) : $path, 300);
    }

    /** @param array<string, mixed> $block */
    private function toolResult(array $block): void
    {
        $id = $block['tool_use_id'] ?? null;

        if (is_string($id) && isset($this->running[$id])) {
            unset($this->running[$id]);
            $this->activity->agent(['id' => $id, 'step' => 'Đã xong', 'status' => 'done'] + (($this->files[$id] ?? []) !== [] ? ['files' => $this->files[$id]] : []));
        }
    }

    /**
     * @param  array<mixed>  $todos
     * @return list<array{content: string, status: string}>
     */
    private function todos(array $todos): array
    {
        $list = [];

        foreach (array_slice($todos, 0, 50) as $todo) {
            if (is_array($todo) && is_string($todo['content'] ?? null)) {
                $status = $todo['status'] ?? '';
                $list[] = [
                    'content' => $this->text($todo['content'], 160),
                    'status' => in_array($status, ['in_progress', 'completed'], true) ? $status : 'pending',
                ];
            }
        }

        return $list;
    }

    private function text(mixed $value, int $limit): string
    {
        return is_string($value) ? mb_substr($value, 0, $limit) : '';
    }
}
