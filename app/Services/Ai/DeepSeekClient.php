<?php

declare(strict_types=1);

namespace App\Services\Ai;

/** * DeepSeek speaks the OpenAI Chat Completions format (`POST /chat/completions`). */
final class DeepSeekClient extends OpenAiClient
{
    // * Unverified default: set `Mô hình` on the integration to pin a model.
    protected const DEFAULT_MODEL = 'deepseek-chat';

    protected const ENDPOINT = 'https://api.deepseek.com/chat/completions';
}
