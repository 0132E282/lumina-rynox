<?php

declare(strict_types=1);

namespace App\Services\Posting;

use RuntimeException;

/** * Ends a publisher early with a settled outcome; the message is safe to store and show (never holds a token or URL). */
final class PublishAborted extends RuntimeException
{
    private function __construct(string $message, public readonly bool $ambiguous, public readonly bool $haltsBatch = false)
    {
        parent::__construct($message);
    }

    public static function failed(string $message): self
    {
        return new self($message, false);
    }

    public static function unknown(string $message): self
    {
        return new self($message, true);
    }

    /** * A refusal after which the rest of the group batch must not run either (hourly cap reached). */
    public static function failedHaltingBatch(string $message): self
    {
        return new self($message, false, true);
    }

    public function result(): PublishResult
    {
        $result = $this->ambiguous ? PublishResult::unknown($this->getMessage()) : PublishResult::failed($this->getMessage());

        return $this->haltsBatch ? $result->haltingBatch() : $result;
    }
}
