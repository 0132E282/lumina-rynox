<?php

declare(strict_types=1);

namespace App\Services\Integrations;

/** * Outcome of `IntegrationProvider::test()`. `supported` false means no real check exists, so `ok` carries no meaning. */
final readonly class ConnectionTestResult
{
    private function __construct(
        public bool $supported,
        public bool $ok,
        public string $message,
    ) {}

    public static function unsupported(): self
    {
        return new self(false, false, 'Chưa hỗ trợ kiểm tra kết nối');
    }

    public static function passed(string $message): self
    {
        return new self(true, true, $message);
    }

    public static function failed(string $message): self
    {
        return new self(true, false, $message);
    }
}
