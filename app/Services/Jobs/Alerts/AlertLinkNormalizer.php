<?php

declare(strict_types=1);

namespace App\Services\Jobs\Alerts;

use Illuminate\Support\Str;

/**
 * Turns an href from an alert mail into a clean public job URL, or null. Only http/https on the source's own hosts is accepted;
 * unsubscribe links are refused; a click-tracking wrapper is unwrapped only when its destination parameter lands on an allowed host.
 * The query string and fragment are always dropped: a job page is identified by its path, and tracking tokens would break de-duplication.
 */
final class AlertLinkNormalizer
{
    private const MAX_URL_LENGTH = 500;

    /** @param array{link_hosts: list<string>, job_path: string} $profile */
    public function normalize(string $href, array $profile): ?string
    {
        return $this->clean(html_entity_decode(trim($href), ENT_QUOTES | ENT_HTML5), $profile, true);
    }

    /** @param array{link_hosts: list<string>, job_path: string} $profile */
    private function clean(string $href, array $profile, bool $mayUnwrap): ?string
    {
        $parts = parse_url($href);

        if ($parts === false || ! in_array(Str::lower($parts['scheme'] ?? ''), ['http', 'https'], true)
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) {
            return null;
        }

        $host = Str::lower(rtrim((string) ($parts['host'] ?? ''), '.'));
        $lowerHref = Str::lower($href);

        foreach ((array) config('jobs.alerts.ignored_link_words', []) as $word) {
            if (str_contains($lowerHref, (string) $word)) {
                return null;
            }
        }

        if ($host === '' || ! $this->hostAllowed($host, $profile['link_hosts'])) {
            return $mayUnwrap ? $this->unwrap($parts['query'] ?? '', $profile) : null;
        }

        $path = '/'.trim(rawurldecode((string) ($parts['path'] ?? '')), '/');

        if (preg_match($profile['job_path'], $path) !== 1) {
            // * A tracking host on the source's own domain (e.g. click.<site>) wraps the real link in a query parameter.
            return $mayUnwrap ? $this->unwrap($parts['query'] ?? '', $profile) : null;
        }

        $url = 'https://'.$host.implode('/', array_map('rawurlencode', explode('/', $path)));

        return strlen($url) <= self::MAX_URL_LENGTH ? $url : null;
    }

    /** @param array{link_hosts: list<string>, job_path: string} $profile */
    private function unwrap(string $query, array $profile): ?string
    {
        parse_str($query, $params);

        foreach ((array) config('jobs.alerts.redirect_params', []) as $name) {
            $value = $params[$name] ?? null;

            if (is_string($value) && preg_match('#^https?://#i', $value) === 1) {
                return $this->clean($value, $profile, false);
            }
        }

        return null;
    }

    /** @param list<string> $allowed */
    private function hostAllowed(string $host, array $allowed): bool
    {
        foreach ($allowed as $domain) {
            if ($host === $domain || str_ends_with($host, '.'.$domain)) {
                return true;
            }
        }

        return false;
    }
}
