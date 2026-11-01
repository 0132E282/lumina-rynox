<?php

declare(strict_types=1);

namespace App\Services\Posting;

use App\Models\PostTarget;

final readonly class PublishResult
{
    private function __construct(
        public string $status,
        public ?string $externalId = null,
        public ?string $externalUrl = null,
        public ?string $error = null,
        // * True when the batch of group posts of this provider must stop here (checkpoint, not logged in, hourly cap).
        public bool $haltsBatch = false,
    ) {}

    public static function published(string $externalId, ?string $externalUrl = null): self
    {
        return new self(PostTarget::STATUS_PUBLISHED, $externalId, $externalUrl);
    }

    public static function failed(string $error): self
    {
        return new self(PostTarget::STATUS_FAILED, error: $error);
    }

    public static function unknown(string $error): self
    {
        return new self(PostTarget::STATUS_UNKNOWN, error: $error);
    }

    public function haltingBatch(): self
    {
        return new self($this->status, $this->externalId, $this->externalUrl, $this->error, true);
    }
}
