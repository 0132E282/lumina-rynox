<?php

declare(strict_types=1);

namespace App\Services\Chat;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Title, description and picture of a web page for the composer's link card. The server fetches the page itself, so
 * only public http(s) hosts are allowed: every hop (redirects are followed by hand) is resolved, refused when any
 * address is private or reserved, and the connection is pinned to the address that was checked.
 */
final class LinkPreview
{
    private const MAX_BYTES = 524288;

    private const MAX_HOPS = 3;

    private const TIMEOUT_SECONDS = 5;

    /** @return array{url: string, host: string, title: string|null, description: string|null, image: string|null}|null */
    public function fetch(string $url): ?array
    {
        $current = $url;

        for ($hop = 0; $hop <= self::MAX_HOPS; $hop++) {
            $target = $this->publicTarget($current);

            if ($target === null) {
                return null;
            }

            try {
                $response = Http::timeout(self::TIMEOUT_SECONDS)
                    ->connectTimeout(3)
                    ->withoutRedirecting()
                    ->withHeaders(['Accept' => 'text/html', 'User-Agent' => 'Mozilla/5.0 (compatible; LinkPreview)'])
                    ->withOptions(['stream' => true, 'curl' => [CURLOPT_RESOLVE => ["{$target['host']}:{$target['port']}:{$target['ip']}"]]])
                    ->get($current);
            } catch (ConnectionException) {
                return null;
            }

            if ($response->redirect()) {
                $location = $response->header('Location');
                $next = $location === '' ? null : $this->absolute($current, $location);

                if ($next === null) {
                    return null;
                }

                $current = $next;

                continue;
            }

            if (! $response->successful() || ! str_contains(strtolower($response->header('Content-Type')), 'html')) {
                return null;
            }

            return $this->parse($current, $this->readCapped($response->toPsrResponse()->getBody()));
        }

        return null;
    }

    private function readCapped(mixed $stream): string
    {
        $data = '';

        while (! $stream->eof() && strlen($data) < self::MAX_BYTES) {
            $data .= $stream->read(8192);
        }

        return $data;
    }

    /** @return array{host: string, port: int, ip: string}|null */
    private function publicTarget(string $url): ?array
    {
        $parts = parse_url($url);
        $scheme = $parts['scheme'] ?? null;
        $host = $parts['host'] ?? null;

        if (! in_array($scheme, ['http', 'https'], true) || ! is_string($host) || isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }

        $addresses = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);

        if ($addresses === []) {
            return null;
        }

        foreach ($addresses as $address) {
            if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
                return null;
            }
        }

        return ['host' => $host, 'port' => $parts['port'] ?? ($scheme === 'https' ? 443 : 80), 'ip' => $addresses[0]];
    }

    private function absolute(string $base, string $reference): ?string
    {
        if (preg_match('#^https?://#i', $reference) === 1) {
            return $reference;
        }

        $parts = parse_url($base);

        if (! isset($parts['scheme'], $parts['host'])) {
            return null;
        }

        $origin = $parts['scheme'].'://'.$parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');

        if (str_starts_with($reference, '//')) {
            return $parts['scheme'].':'.$reference;
        }

        if (str_starts_with($reference, '/')) {
            return $origin.$reference;
        }

        return $origin.rtrim(dirname($parts['path'] ?? '/'), '/').'/'.$reference;
    }

    /** @return array{url: string, host: string, title: string|null, description: string|null, image: string|null}|null */
    private function parse(string $url, string $html): ?array
    {
        $previous = libxml_use_internal_errors(true);
        $document = new \DOMDocument;
        $document->loadHTML('<?xml encoding="utf-8" ?>'.$html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $meta = [];

        foreach ($document->getElementsByTagName('meta') as $tag) {
            $key = strtolower($tag->getAttribute('property') ?: $tag->getAttribute('name'));

            if ($key !== '' && ! isset($meta[$key])) {
                $meta[$key] = trim($tag->getAttribute('content'));
            }
        }

        $titleTag = $document->getElementsByTagName('title')->item(0);
        $title = $this->clean($meta['og:title'] ?? '') ?? $this->clean($titleTag?->textContent ?? '');
        $description = $this->clean($meta['og:description'] ?? '') ?? $this->clean($meta['description'] ?? '');
        $image = isset($meta['og:image']) && $meta['og:image'] !== '' ? $this->absolute($url, $meta['og:image']) : null;

        if ($title === null && $description === null && $image === null) {
            return null;
        }

        return [
            'url' => $url,
            'host' => (string) parse_url($url, PHP_URL_HOST),
            'title' => $title,
            'description' => $description,
            'image' => $image,
        ];
    }

    private function clean(string $value): ?string
    {
        $value = trim(preg_replace('/\s+/u', ' ', $value) ?? '');

        return $value === '' ? null : Str::limit($value, 300, '…');
    }
}
