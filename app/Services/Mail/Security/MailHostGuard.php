<?php

declare(strict_types=1);

namespace App\Services\Mail\Security;

/**
 * SSRF guard for user-supplied IMAP/SMTP hosts: refuses IPs, and names resolving to IPs, that are not on the public internet.
 *
 * ! Residual risk (DNS rebinding): the socket library resolves the name again when it connects. Pinning the IP would break
 * ! SNI and certificate checks, so it is not done; TLS verification against the hostname is the second line of defence.
 */
final class MailHostGuard
{
    private const BLOCKED_V4 = [
        '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
        '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15',
        '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
    ];

    // * ::/8 covers unspecified, loopback and IPv4-compatible; 64:ff9b::/96 (NAT64), 2002::/16 (6to4) and 2001::/32 (Teredo) embed IPv4.
    private const BLOCKED_V6 = [
        '::/8', '64:ff9b::/96', '100::/64', '2001::/32', '2001:db8::/32', '2002::/16', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8',
    ];

    public function __construct(private readonly DnsResolver $resolver) {}

    /**
     * @throws BlockedHostException
     */
    public function assertPublic(string $host): void
    {
        if ((bool) config('mailbox.allow_private_hosts')) {
            return;
        }

        $host = $this->normalise($host);

        if ($host === '' || $host === 'localhost' || str_ends_with($host, '.localhost')) {
            throw BlockedHostException::make();
        }

        $isIp = filter_var($host, FILTER_VALIDATE_IP) !== false;

        // * Shorthand IPv4 forms (octal `0177.0.0.1`, hex `0x7f.1`, decimal `2130706433`) are read by OS resolvers as IPs; refuse them outright.
        if (! $isIp && preg_match('/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*$/', $host) === 1) {
            throw BlockedHostException::make();
        }

        $addresses = $isIp ? [$host] : $this->resolver->resolve($host);

        // * A name that does not resolve cannot be proven public, so it is refused too.
        if ($addresses === []) {
            throw BlockedHostException::make();
        }

        foreach ($addresses as $address) {
            if (! $this->isPublicAddress($address)) {
                throw BlockedHostException::make();
            }
        }
    }

    public function isPublicAddress(string $address): bool
    {
        $packed = filter_var($address, FILTER_VALIDATE_IP) !== false ? inet_pton($address) : false;

        if ($packed === false) {
            return false;
        }

        // * IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged by its IPv4 part.
        if (strlen($packed) === 16 && str_starts_with($packed, str_repeat("\0", 10)."\xff\xff")) {
            $packed = substr($packed, 12);
            $address = (string) inet_ntop($packed);
        }

        $isV4 = strlen($packed) === 4;

        if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return false;
        }

        foreach ($isV4 ? self::BLOCKED_V4 : self::BLOCKED_V6 as $cidr) {
            if ($this->inRange($packed, $cidr)) {
                return false;
            }
        }

        return true;
    }

    /** * Trimmed, lower-cased, without brackets or a trailing dot. */
    public function normalise(string $host): string
    {
        $host = rtrim(strtolower(trim($host, " \t\n\r\0\x0B[]")), '.');

        if ($host !== '' && ! mb_check_encoding($host, 'ASCII') && function_exists('idn_to_ascii')) {
            $ascii = idn_to_ascii($host);
            $host = $ascii === false ? $host : $ascii;
        }

        return $host;
    }

    private function inRange(string $packedAddress, string $cidr): bool
    {
        [$network, $prefix] = explode('/', $cidr);
        $packedNetwork = (string) inet_pton($network);
        $bits = (int) $prefix;

        $fullBytes = intdiv($bits, 8);

        if (substr($packedAddress, 0, $fullBytes) !== substr($packedNetwork, 0, $fullBytes)) {
            return false;
        }

        $remainder = $bits % 8;

        if ($remainder === 0) {
            return true;
        }

        $mask = (0xFF << (8 - $remainder)) & 0xFF;

        return (ord($packedAddress[$fullBytes]) & $mask) === (ord($packedNetwork[$fullBytes]) & $mask);
    }
}
