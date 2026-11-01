<?php

declare(strict_types=1);

namespace App\Services\Jobs;

use Carbon\CarbonImmutable;
use DOMElement;
use DOMXPath;

/**
 * Parses the public search page `/it-jobs?query=<keyword>&page=<n>` (checked against the live page on 2026-10-27). Each result is
 * `div.job-card[data-search--job-selection-job-slug-value]`. Without login the salary is replaced by "Sign in to view salary",
 * so `salary_text` stays null. An empty result page answers with the title "Search term not found" and no cards.
 */
final class ItviecCrawler extends AbstractJobCrawler
{
    private const TAG_LIMIT = 10;

    public function source(): string
    {
        return 'itviec';
    }

    protected function baseUrl(): string
    {
        return (string) config('jobs.sources.itviec.base_url');
    }

    protected function searchPath(string $keyword, int $page): string
    {
        return '/it-jobs?'.http_build_query(['query' => $keyword] + ($page > 1 ? ['page' => $page] : []));
    }

    protected function parse(string $html): array
    {
        $xpath = $this->xpath($html);
        $jobs = [];

        foreach ($xpath->query("//div[contains(concat(' ', normalize-space(@class), ' '), ' job-card ')][@data-search--job-selection-job-slug-value]") ?: [] as $card) {
            if ($card instanceof DOMElement && ($job = $this->parseCard($xpath, $card)) !== null) {
                $jobs[] = $job;
            }
        }

        return $jobs;
    }

    private function parseCard(DOMXPath $xpath, DOMElement $card): ?CrawledJob
    {
        $slug = trim($card->getAttribute('data-search--job-selection-job-slug-value'));
        $title = $this->text($xpath, './/h3//a', $card);

        if ($slug === '' || $title === null) {
            return null;
        }

        $tags = [];

        foreach ($xpath->query(".//a[contains(concat(' ', normalize-space(@class), ' '), ' itag ')]", $card) ?: [] as $tag) {
            $tags[] = trim((string) $tag->nodeValue);
        }

        $salary = $this->text($xpath, ".//div[contains(concat(' ', normalize-space(@class), ' '), ' salary ')]", $card);
        $location = $this->first($xpath, ".//div[contains(@class, 'text-truncate')][@title]", $card);

        return new CrawledJob(
            externalId: $slug,
            url: $this->baseUrl().'/it-jobs/'.$slug,
            title: $title,
            company: $this->text($xpath, ".//span[contains(@class, 'text-hover-underline')]//a", $card),
            location: $location === null ? null : (trim($location->getAttribute('title')) ?: null),
            salaryText: $salary !== null && preg_match('/sign in/i', $salary) !== 1 ? $salary : null,
            tags: array_slice(array_values(array_unique(array_filter($tags))), 0, self::TAG_LIMIT),
            postedAt: $this->postedAt($this->text($xpath, ".//span[contains(@class, 'small-text')][contains(., 'Posted')]", $card)),
            meta: ['super_hot' => str_contains($card->getAttribute('class'), 'super-hot')],
        );
    }

    /** "Posted 6 hours ago" / "1 day ago" / "2 weeks ago"; anything else is unknown (null), never guessed. */
    private function postedAt(?string $text): ?CarbonImmutable
    {
        if ($text === null || preg_match('/(\d+)\s*(minute|hour|day|week|month)s?\s+ago/i', $text, $match) !== 1) {
            return null;
        }

        return CarbonImmutable::now()->sub(strtolower($match[2]), (int) $match[1]);
    }
}
