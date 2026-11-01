<?php

declare(strict_types=1);

namespace App\Services\Chat\Zalo;

use RuntimeException;

/** * The sidecar answered with an HTTP error. The message is fixed text: the response body is never copied (it may hold session data). */
class ZaloBridgeException extends RuntimeException
{
    // * Error codes the sidecar may return; anything else is dropped to null.
    public const CODES = ['not_logged_in', 'invalid', 'rejected', 'ambiguous', 'conflict', 'contacts_failed'];

    public function __construct(public readonly int $status, public readonly ?string $errorCode = null)
    {
        parent::__construct("Zalo bridge trả về lỗi (HTTP {$status}).");
    }

    /** * A 5xx may have been processed before the failure, so a send is not known to have failed. */
    public function isAmbiguous(): bool
    {
        return $this->status >= 500;
    }
}
