<?php

declare(strict_types=1);

namespace App\Services\Mail\Exceptions;

final class MailTlsException extends MailException
{
    public static function unsupported(): self
    {
        return new self('Máy chủ không hỗ trợ kết nối mã hoá.');
    }

    public static function certificate(): self
    {
        return new self('Chứng chỉ của máy chủ không hợp lệ.');
    }
}
