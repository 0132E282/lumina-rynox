<?php

declare(strict_types=1);

namespace App\Services\Ai;

interface LlmClient
{
    /**
     * One synchronous call with a fixed timeout, no retry.
     *
     * @throws AiException a fixed-message failure only
     */
    public function complete(string $system, string $prompt): string;
}
