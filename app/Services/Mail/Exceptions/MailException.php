<?php

declare(strict_types=1);

namespace App\Services\Mail\Exceptions;

use RuntimeException;

/**
 * Base of every mail-layer failure. The message is always a fixed sentence that is safe to show and log:
 * the original library exception (which can carry hosts or addresses) is deliberately never wrapped.
 */
abstract class MailException extends RuntimeException {}
