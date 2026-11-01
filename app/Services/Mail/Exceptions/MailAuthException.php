<?php

declare(strict_types=1);

namespace App\Services\Mail\Exceptions;

final class MailAuthException extends MailException
{
    public static function make(): self
    {
        return new self('Sai tài khoản hoặc mật khẩu.');
    }
}
