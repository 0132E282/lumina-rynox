<?php

declare(strict_types=1);

namespace App\Services\Chat\Telegram;

use RuntimeException;

/** * Telegram answered with an HTTP error. The message is Telegram's `description`, never the request URL (it holds the token). */
class TelegramApiException extends RuntimeException
{
    public function __construct(public readonly int $status, string $description)
    {
        parent::__construct($description);
    }

    public function isAuthFailure(): bool
    {
        return $this->status === 401;
    }

    /** * A 5xx may have been processed before the gateway failed, so a send is not known to have failed. */
    public function isAmbiguous(): bool
    {
        return $this->status >= 500;
    }
}
