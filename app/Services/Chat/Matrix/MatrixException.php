<?php

declare(strict_types=1);

namespace App\Services\Chat\Matrix;

use RuntimeException;

/**
 * A Matrix Client-Server API or Provisioning API call failed. The message is fixed text: the response body is never
 * copied (it may hold room content, cookies or tokens).
 */
final class MatrixException extends RuntimeException
{
    private const ERRCODE_PATTERN = '/^M_[A-Z_]+$/';

    public readonly ?string $errcode;

    public function __construct(
        public readonly int $status,
        ?string $errcode = null,
        public readonly bool $notConfigured = false,
    ) {
        parent::__construct("Matrix request failed (HTTP {$status}).");
        $this->errcode = $errcode !== null && preg_match(self::ERRCODE_PATTERN, $errcode) === 1 ? $errcode : null;
    }

    public static function notConfigured(): self
    {
        return new self(503, null, true);
    }

    /** * A 5xx may have been processed before the failure, so a request is not known to have failed. */
    public function isAmbiguous(): bool
    {
        return $this->status >= 500;
    }

    public function isAuthFailure(): bool
    {
        return $this->status === 401 || $this->errcode === 'M_UNKNOWN_TOKEN';
    }
}
