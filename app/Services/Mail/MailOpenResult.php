<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Models\MailMessage;

final class MailOpenResult
{
    /**
     * @param  bool  $flagsSynced  false when the \Seen change could not be sent to the server yet (kept as `flags_dirty`)
     * @param  string|null  $error  fixed sentence when the body could not be loaded; the message is then left unchanged
     */
    public function __construct(
        public readonly MailMessage $message,
        public readonly bool $flagsSynced = true,
        public readonly ?string $error = null,
    ) {}

    public function failed(): bool
    {
        return $this->error !== null;
    }
}
