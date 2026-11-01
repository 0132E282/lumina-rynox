<?php

declare(strict_types=1);

namespace App\Services\Integrations;

use RuntimeException;

/** Failure of the LinkedIn sign-in whose message is fixed text, safe to show the user. */
final class LinkedInOAuthException extends RuntimeException {}
