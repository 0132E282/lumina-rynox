<?php

declare(strict_types=1);

namespace App\Services\Chat\Telegram;

use RuntimeException;

/** * The channel cannot send right now (lost connection, send scope off). The message is safe to show the user. */
class ChatUnavailableException extends RuntimeException {}
