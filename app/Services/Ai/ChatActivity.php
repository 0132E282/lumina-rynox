<?php

declare(strict_types=1);

namespace App\Services\Ai;

/**
 * What the app itself read or looked up for one chat message (file trees, files named in the message, attachments), in order.
 * ! Names and counts only, never file content; scoped to the request and sent back with the answer so the person can see what the AI was given.
 */
final class ChatActivity
{
    /** @var list<array{kind: string, source: string, detail: string}> */
    private array $steps = [];

    /** @var (\Closure(array{kind: string, source: string, detail: string}): void)|null */
    private ?\Closure $listener = null;

    public function record(string $kind, string $source, string $detail = ''): void
    {
        $step = ['kind' => $kind, 'source' => $source, 'detail' => mb_substr($detail, 0, 200)];
        $this->steps[] = $step;

        if ($this->listener !== null) {
            ($this->listener)($step);
        }
    }

    /** @var (\Closure(array<string, mixed>): void)|null */
    private ?\Closure $agentListener = null;

    /** * A subagent the AI started, moved on or finished. Streamed live only: it is not part of the steps stored with the answer. */
    public function agent(array $event): void
    {
        if ($this->agentListener !== null) {
            ($this->agentListener)($event);
        }
    }

    /** @var (\Closure(list<array{content: string, status: string}>): void)|null */
    private ?\Closure $planListener = null;

    /** * The plan (to-do list) the AI keeps for this answer, each time it updates it. Streamed live only. */
    public function plan(array $todos): void
    {
        if ($this->planListener !== null) {
            ($this->planListener)($todos);
        }
    }

    public function listenPlan(\Closure $listener): void
    {
        $this->planListener = $listener;
    }

    /** * True while the answer is streamed to a browser that shows the plan and subagents. */
    public function showsPlan(): bool
    {
        return $this->planListener !== null;
    }

    public function listenAgents(\Closure $listener): void
    {
        $this->agentListener = $listener;
    }

    /** * Called with every step as it is recorded (the streamed send writes each one to the browser at once). */
    public function listen(\Closure $listener): void
    {
        $this->listener = $listener;
    }

    /** @return list<array{kind: string, source: string, detail: string}> */
    public function all(): array
    {
        return $this->steps;
    }
}
