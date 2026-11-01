<?php

declare(strict_types=1);

namespace App\Services\Ai;

/**
 * * MCP servers the current chat turn may use (request-scoped). Empty means none: the CLI is started without any MCP server.
 */
final class McpPolicy
{
    /** @var list<string> */
    private array $allowed = [];

    /** @param  list<string>  $servers */
    public function allow(array $servers): void
    {
        $this->allowed = array_values(array_unique($servers));
    }

    /** @return list<string> */
    public function allowed(): array
    {
        return $this->allowed;
    }
}
