<?php

declare(strict_types=1);

namespace App\Services\Mail\Security;

interface DnsResolver
{
    /**
     * Every A and AAAA address of the host; empty when it does not resolve.
     *
     * @return list<string>
     */
    public function resolve(string $host): array;
}
