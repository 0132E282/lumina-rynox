<?php

declare(strict_types=1);

namespace App\Services\Mail;

use InvalidArgumentException;

/**
 * A validated `host:port` of an IMAP or SMTP server. Only encrypted ports are accepted, and the encryption follows the port:
 * IMAP 993 = SSL/TLS, 143 = STARTTLS; SMTP 465 = SSL/TLS, 587 = STARTTLS. Plain-text ports are rejected.
 */
final class MailServerAddress
{
    public const KIND_IMAP = 'imap';

    public const KIND_SMTP = 'smtp';

    public const ENCRYPTION_SSL = 'ssl';

    public const ENCRYPTION_STARTTLS = 'starttls';

    private const PORTS = [
        self::KIND_IMAP => [993 => self::ENCRYPTION_SSL, 143 => self::ENCRYPTION_STARTTLS],
        self::KIND_SMTP => [465 => self::ENCRYPTION_SSL, 587 => self::ENCRYPTION_STARTTLS],
    ];

    private function __construct(
        public readonly string $host,
        public readonly int $port,
        public readonly string $encryption,
    ) {}

    /**
     * @param  'imap'|'smtp'  $kind
     *
     * @throws InvalidArgumentException when the text is not `host:port` or the port is not an encrypted one
     */
    public static function parse(string $address, string $kind): self
    {
        $address = trim($address);

        // * Bracketed IPv6 literal `[::1]:993`, otherwise `host:port` split on the last colon.
        if (preg_match('/^\[([0-9a-fA-F:.]+)\]:(\d{1,5})$/', $address, $matches) === 1) {
            return self::make($matches[1], (int) $matches[2], $kind);
        }

        if (preg_match('/^([^:\s]+):(\d{1,5})$/', $address, $matches) !== 1) {
            throw new InvalidArgumentException('Máy chủ phải có dạng tên-máy:cổng.');
        }

        return self::make($matches[1], (int) $matches[2], $kind);
    }

    /**
     * @param  'imap'|'smtp'  $kind
     *
     * @throws InvalidArgumentException
     */
    public static function make(string $host, int $port, string $kind): self
    {
        $host = rtrim(strtolower(trim($host)), '.');

        if (! self::isValidHost($host)) {
            throw new InvalidArgumentException('Tên máy chủ không hợp lệ.');
        }

        $encryption = self::PORTS[$kind][$port] ?? null;

        if ($encryption === null) {
            throw new InvalidArgumentException('Cổng không được hỗ trợ: chỉ chấp nhận cổng có mã hoá ('.implode(' hoặc ', array_keys(self::PORTS[$kind])).').');
        }

        return new self($host, $port, $encryption);
    }

    /** @return list<int> */
    public static function allowedPorts(string $kind): array
    {
        return array_keys(self::PORTS[$kind]);
    }

    public function toString(): string
    {
        return str_contains($this->host, ':') ? "[{$this->host}]:{$this->port}" : "{$this->host}:{$this->port}";
    }

    private static function isValidHost(string $host): bool
    {
        if ($host === '' || strlen($host) > 253) {
            return false;
        }

        // * IP literal (v4 or v6) or an ASCII domain name; no scheme, path, credentials or whitespace can get through.
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return true;
        }

        // * Numeric-looking names (`0177.0.0.1`) are IP shorthand to the OS resolver, so a name must contain a letter.
        if (preg_match('/[a-z]/', $host) !== 1) {
            return false;
        }

        return preg_match('/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/', $host) === 1;
    }
}
