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

    public function record(string $kind, string $source, string $detail = ''): void
    {
        $this->steps[] = ['kind' => $kind, 'source' => $source, 'detail' => mb_substr($detail, 0, 200)];
    }

    /** @return list<array{kind: string, source: string, detail: string}> */
    public function all(): array
    {
        return $this->steps;
    }
}
