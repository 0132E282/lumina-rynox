<?php

declare(strict_types=1);

namespace App\Services\Jobs;

use DOMDocument;
use DOMElement;
use DOMXPath;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Polite public-page crawler: honest User-Agent, timeout, pause between requests, robots.txt first, a page cap, and a hard stop
 * on 403/429/captcha. There is no retry, proxy or header trick; a refusal ends the source's run.
 */
abstract class AbstractJobCrawler implements JobCrawler
{
    private ?RobotsPolicy $robots = null;

    private int $requests = 0;

    abstract protected function baseUrl(): string;

    /** Path plus query of the search page for one keyword. */
    abstract protected function searchPath(string $keyword, int $page): string;

    /** @return list<CrawledJob> */
    abstract protected function parse(string $html): array;

    public function crawl(JobCriteria $criteria): CrawlResult
    {
        if ($criteria->isEmpty()) {
            return new CrawlResult(CrawlResult::STATUS_NO_CRITERIA, 'Chưa có tiêu chí lọc: nhập "Tiêu chí tự lọc" ở trang Tích hợp.');
        }

        $jobs = [];

        try {
            foreach (array_slice($criteria->keywords, 0, (int) config('jobs.max_keywords')) as $keyword) {
                for ($page = 1; $page <= (int) config('jobs.max_pages'); $page++) {
                    $html = $this->fetch($this->searchPath($keyword, $page));
                    $found = $html === null ? [] : $this->parse($html);

                    if ($found === []) {
                        break;
                    }

                    foreach ($found as $job) {
                        $jobs[$job->externalId] = $job;
                    }
                }
            }
        } catch (CrawlStoppedException $stopped) {
            return new CrawlResult($stopped->status, $stopped->getMessage(), array_values($jobs));
        }

        return new CrawlResult(CrawlResult::STATUS_OK, 'Đã đọc '.count($jobs).' việc làm.', array_values($jobs));
    }

    /**
     * Body of a public page, or null when the page does not exist (404).
     *
     * @throws CrawlStoppedException
     */
    protected function fetch(string $pathAndQuery): ?string
    {
        $this->robots ??= $this->loadRobots();

        if (! $this->robots->allows($pathAndQuery)) {
            throw new CrawlStoppedException(CrawlResult::STATUS_DISALLOWED, 'robots.txt của '.$this->source().' không cho phép đường dẫn tìm kiếm.');
        }

        $response = $this->get($pathAndQuery);

        if ($response->status() === 404) {
            return null;
        }

        if (! $response->successful()) {
            throw new CrawlStoppedException(CrawlResult::STATUS_ERROR, $this->source().' trả về HTTP '.$response->status().'.');
        }

        return $response->body();
    }

    /**
     * Readable text of one public job page (same politeness and block rules as a search), or null when it is gone, off this site or empty.
     *
     * @throws CrawlStoppedException
     */
    public function pageText(string $url, int $maxChars): ?string
    {
        $parts = parse_url($url);
        $base = parse_url($this->baseUrl());

        if (! is_array($parts) || ! is_array($base) || ($parts['host'] ?? null) !== ($base['host'] ?? null) || ! in_array($parts['scheme'] ?? '', ['http', 'https'], true)) {
            return null;
        }

        $html = $this->fetch(($parts['path'] ?? '/').(isset($parts['query']) ? '?'.$parts['query'] : ''));

        if ($html === null) {
            return null;
        }

        $document = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="UTF-8">'.$html);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $xpath = new DOMXPath($document);

        foreach ($xpath->query('//script|//style|//noscript|//svg|//nav|//header|//footer') ?: [] as $node) {
            $node->parentNode?->removeChild($node);
        }

        $text = trim((string) preg_replace('/\s+/u', ' ', (string) $document->documentElement?->textContent));

        return $text === '' ? null : mb_substr($text, 0, $maxChars);
    }

    protected function xpath(string $html): DOMXPath
    {
        $document = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="UTF-8">'.$html);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        return new DOMXPath($document);
    }

    protected function first(DOMXPath $xpath, string $expression, DOMElement $context): ?DOMElement
    {
        $nodes = $xpath->query($expression, $context);
        $node = $nodes === false ? null : $nodes->item(0);

        return $node instanceof DOMElement ? $node : null;
    }

    /** Whitespace-collapsed text of the first match, or null when missing or empty. */
    protected function text(DOMXPath $xpath, string $expression, DOMElement $context): ?string
    {
        $node = $this->first($xpath, $expression, $context);
        $text = $node === null ? '' : trim((string) preg_replace('/\s+/u', ' ', $node->textContent));

        return $text === '' ? null : $text;
    }

    /** XPath test for a whole class token, e.g. `job-card`. */
    protected function hasClass(string $class): string
    {
        return "contains(concat(' ', normalize-space(@class), ' '), ' {$class} ')";
    }

    private function loadRobots(): RobotsPolicy
    {
        $response = $this->get('/robots.txt');

        // * No robots.txt means no restriction; any other failure is not guessed around.
        return match (true) {
            $response->status() === 404 => new RobotsPolicy(''),
            $response->successful() => new RobotsPolicy($response->body()),
            default => throw new CrawlStoppedException(CrawlResult::STATUS_ERROR, 'Không đọc được robots.txt của '.$this->source().' (HTTP '.$response->status().').'),
        };
    }

    /** @throws CrawlStoppedException */
    private function get(string $pathAndQuery): Response
    {
        if ($this->requests++ > 0) {
            usleep((int) config('jobs.delay_milliseconds') * 1000);
        }

        try {
            $response = $this->client()->get($this->baseUrl().$pathAndQuery);
        } catch (ConnectionException) {
            throw new CrawlStoppedException(CrawlResult::STATUS_ERROR, 'Không kết nối được tới '.$this->source().'.');
        }

        if (in_array($response->status(), [403, 429], true) || $this->looksLikeChallenge($response->body())) {
            throw new CrawlStoppedException(CrawlResult::STATUS_BLOCKED, $this->source().' đang chặn truy cập tự động (HTTP '.$response->status().'); dừng và không thử lại.');
        }

        return $response;
    }

    private function looksLikeChallenge(string $body): bool
    {
        return preg_match('/captcha|cf-challenge|Attention Required! \| Cloudflare|Just a moment\.\.\./i', mb_substr($body, 0, 20000)) === 1;
    }

    private function client(): PendingRequest
    {
        return Http::withUserAgent((string) config('jobs.user_agent'))
            ->accept('text/html')
            ->timeout((int) config('jobs.http_timeout_seconds'))
            ->connectTimeout(5);
    }
}
