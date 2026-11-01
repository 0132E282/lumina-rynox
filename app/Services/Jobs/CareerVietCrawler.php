<?php

declare(strict_types=1);

namespace App\Services\Jobs;

use Carbon\CarbonImmutable;
use DOMElement;
use Illuminate\Support\Str;
use Throwable;

/**
 * Parses the public search page `/viec-lam/<keyword>-k-vi.html` and `/viec-lam/<keyword>-k-trang-<n>-vi.html` (checked against the live
 * page on 2026-10-27; server-rendered). Each result is `div.job-item`; `robots.txt` only blocks `/vi/jobs/*` and similar, not these paths.
 * `posted_at` is the listing's "Cập nhật" date (dd-mm-yyyy). A page past the last one lists no `job-item`.
 */
final class CareerVietCrawler extends AbstractJobCrawler
{
    private const TAG_LIMIT = 10;

    public function source(): string
    {
        return 'careerviet';
    }

    protected function baseUrl(): string
    {
        return (string) config('jobs.sources.careerviet.base_url');
    }

    protected function searchPath(string $keyword, int $page): string
    {
        return '/viec-lam/'.Str::slug($keyword).($page > 1 ? "-k-trang-{$page}" : '-k').'-vi.html';
    }

    protected function parse(string $html): array
    {
        $xpath = $this->xpath($html);
        $jobs = [];

        foreach ($xpath->query('//div['.$this->hasClass('job-item').'][starts-with(@id, "job-item-")]') ?: [] as $card) {
            if (! $card instanceof DOMElement) {
                continue;
            }

            $link = $this->first($xpath, './/h2//a', $card);
            $path = $link === null ? '' : (string) parse_url($link->getAttribute('href'), PHP_URL_PATH);
            $title = $this->text($xpath, './/h2//a', $card);
            $externalId = substr($card->getAttribute('id'), strlen('job-item-'));

            if ($path === '' || $title === null || $externalId === '') {
                continue;
            }

            $tags = [];

            foreach ($xpath->query('.//ul['.$this->hasClass('welfare').']/li', $card) ?: [] as $tag) {
                $tags[] = trim((string) $tag->nodeValue);
            }

            $salary = $this->text($xpath, './/div['.$this->hasClass('salary').']', $card);
            $location = $this->first($xpath, './/div['.$this->hasClass('location').'][@title]', $card);

            $jobs[] = new CrawledJob(
                externalId: $externalId,
                url: $this->baseUrl().$path,
                title: $title,
                company: $this->text($xpath, './/a['.$this->hasClass('company-name').']', $card),
                location: $location === null ? null : (trim($location->getAttribute('title')) ?: null),
                salaryText: $salary === null ? null : (trim((string) preg_replace('/^Lương:\s*/u', '', $salary)) ?: null),
                tags: array_slice(array_values(array_unique(array_filter($tags))), 0, self::TAG_LIMIT),
                postedAt: $this->updatedAt($this->text($xpath, './/li[contains(., "Cập nhật")]//time', $card)),
            );
        }

        return $jobs;
    }

    /** "16-10-2026" at the start of that day in the personal time zone; anything else is unknown (null). */
    private function updatedAt(?string $text): ?CarbonImmutable
    {
        if ($text === null) {
            return null;
        }

        try {
            return CarbonImmutable::createFromFormat('!d-m-Y', $text, (string) config('cms.personal_timezone', 'Asia/Ho_Chi_Minh')) ?: null;
        } catch (Throwable) {
            return null;
        }
    }
}
