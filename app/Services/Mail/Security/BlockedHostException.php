<?php

declare(strict_types=1);

namespace App\Services\Mail\Security;

use App\Services\Mail\Exceptions\MailException;

final class BlockedHostException extends MailException
{
    public static function make(): self
    {
        return new self('Máy chủ này không được phép kết nối.');
    }
}
