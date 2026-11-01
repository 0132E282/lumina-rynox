<?php

declare(strict_types=1);

namespace App\Services\Mail\Imap;

final class RemoteFolder
{
    /** @param list<string> $attributes e.g. `\Sent`, `\HasNoChildren` */
    public function __construct(
        public readonly string $name,
        public readonly array $attributes = [],
    ) {}

    public function isSpecialUse(string $attribute): bool
    {
        foreach ($this->attributes as $candidate) {
            if (strcasecmp($candidate, $attribute) === 0) {
                return true;
            }
        }

        return false;
    }
}
