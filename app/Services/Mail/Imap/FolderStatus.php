<?php

declare(strict_types=1);

namespace App\Services\Mail\Imap;

final class FolderStatus
{
    public function __construct(
        public readonly int $uidValidity,
        public readonly int $uidNext,
        public readonly int $exists,
    ) {}
}
