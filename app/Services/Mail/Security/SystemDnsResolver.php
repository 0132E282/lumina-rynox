<?php

declare(strict_types=1);

namespace App\Services\Mail\Security;

final class SystemDnsResolver implements DnsResolver
{
    public function resolve(string $host): array
    {
        // * `dns_get_record` warns (not throws) when the lookup fails; "does not resolve" is a normal outcome here.
        $records = @dns_get_record($host, DNS_A | DNS_AAAA);
        $addresses = [];

        foreach (is_array($records) ? $records : [] as $record) {
            $address = $record['ip'] ?? $record['ipv6'] ?? null;

            if (is_string($address) && $address !== '') {
                $addresses[] = $address;
            }
        }

        if ($addresses === []) {
            // * Fallback for resolvers that answer through the OS (hosts file, search domains) but not via raw DNS.
            $fallback = @gethostbynamel($host);
            $addresses = is_array($fallback) ? $fallback : [];
        }

        return array_values(array_unique($addresses));
    }
}
