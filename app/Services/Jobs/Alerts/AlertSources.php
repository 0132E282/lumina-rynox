<?php

declare(strict_types=1);

namespace App\Services\Jobs\Alerts;

use Illuminate\Support\Str;

/**
 * Read access to `config('jobs.alerts')`: which sources exist and which source a sender address belongs to.
 */
final class AlertSources
{
    /** @return array<string, array{name: string, letter: string, color: string, sender_domains: list<string>, link_hosts: list<string>, job_path: string}> */
    public function all(): array
    {
        return (array) config('jobs.alerts.sources', []);
    }

    /** @return list<string> */
    public function keys(): array
    {
        return array_keys($this->all());
    }

    /** @return list<string> Every allowlisted sender domain, for the mail query. */
    public function senderDomains(): array
    {
        return array_values(array_unique(array_merge(...array_map(fn (array $profile): array => $profile['sender_domains'], array_values($this->all())))));
    }

    /** Source key for a From address, or null when the domain is not on the allowlist. */
    public function resolveSender(?string $email): ?string
    {
        $domain = Str::lower(Str::afterLast((string) $email, '@'));

        if ($domain === '' || ! str_contains((string) $email, '@')) {
            return null;
        }

        foreach ($this->all() as $key => $profile) {
            foreach ($profile['sender_domains'] as $allowed) {
                if ($domain === $allowed || str_ends_with($domain, '.'.$allowed)) {
                    return $key;
                }
            }
        }

        return null;
    }
}
