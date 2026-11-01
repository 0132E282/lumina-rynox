<?php

declare(strict_types=1);

namespace App\Services\Mail\Exceptions;

final class MailProtocolException extends MailException
{
    public static function make(): self
    {
        return new self('Máy chủ trả về phản hồi không hợp lệ.');
    }
}
