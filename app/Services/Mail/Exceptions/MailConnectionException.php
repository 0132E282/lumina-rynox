<?php

declare(strict_types=1);

namespace App\Services\Mail\Exceptions;

final class MailConnectionException extends MailException
{
    public static function unreachable(): self
    {
        return new self('Không kết nối được máy chủ.');
    }

    public static function timeout(): self
    {
        return new self('Hết thời gian chờ máy chủ.');
    }
}
