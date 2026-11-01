<?php

declare(strict_types=1);

namespace App\Services\Jobs\Alerts;

use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Illuminate\Support\Str;

/**
 * Extracts jobs from the HTML of one alert mail. The layout of a real alert mail was not available when this was written, so it
 * does not rely on markup: a job is an `<a>` whose cleaned URL matches the source's `job_path`; the smallest surrounding block that
 * holds no other job link supplies the text lines, from which salary (money pattern), location (known place) and company (first
 * remaining line) are guessed. Anything it cannot tell stays null; text only, never HTML.
 */
final class JobAlertParser
{
    private const CALL_TO_ACTION = '/^(xem|ứng tuyển|apply|view|chi tiết|details|see|nộp|lưu|save|more|read)\b/iu';

    private const SALARY = '/(\d[\d.,]*\s*(?:-|–|—|đến|to)?\s*\d*[\d.,]*\s*(?:triệu|tr\b|usd|vnd|vnđ|đ\b|\$|k\b))|thương lượng|negotiable|up to|tới\s+\d|lên đến|competitive/iu';

    private const LOCATION = '/(hà nội|ha noi|hồ chí minh|ho chi minh|hcm|tp\.?\s*hcm|sài gòn|đà nẵng|da nang|hải phòng|cần thơ|bình dương|remote|từ xa|toàn quốc|nước ngoài)/iu';

    private const TEXT_LIMIT = 255;

    public function __construct(private readonly AlertLinkNormalizer $normalizer) {}

    /**
     * @param  array{link_hosts: list<string>, job_path: string}  $profile
     * @return list<ParsedAlertJob>
     */
    public function parse(string $html, array $profile): array
    {
        $document = $this->load($html);

        if ($document === null) {
            return [];
        }

        $xpath = new DOMXPath($document);
        $anchors = [];

        foreach ($xpath->query('//a[@href]') ?: [] as $anchor) {
            if ($anchor instanceof DOMElement && ($url = $this->normalizer->normalize($anchor->getAttribute('href'), $profile)) !== null) {
                $anchors[] = [$anchor, $url];
            }
        }

        $jobs = [];

        foreach ($anchors as [$anchor, $url]) {
            if (isset($jobs[$url]) && $jobs[$url]->title !== '') {
                continue;
            }

            $job = $this->buildJob($xpath, $anchor, $url, $anchors, $profile);

            if ($job !== null) {
                $jobs[$url] = $job;
            }
        }

        return array_values($jobs);
    }

    /**
     * @param  list<array{0: DOMElement, 1: string}>  $anchors
     * @param  array{link_hosts: list<string>, job_path: string}  $profile
     */
    private function buildJob(DOMXPath $xpath, DOMElement $anchor, string $url, array $anchors, array $profile): ?ParsedAlertJob
    {
        $title = $this->title($xpath, $url, $anchors);

        if ($title === null) {
            return null;
        }

        $lines = [];

        foreach ($xpath->query('.//text()[not(ancestor::style) and not(ancestor::script)]', $this->container($xpath, $anchor, $url, $profile)) ?: [] as $text) {
            $line = $this->clean((string) $text->nodeValue);

            if ($line !== '' && $line !== $title && ! in_array($line, $lines, true) && preg_match(self::CALL_TO_ACTION, $line) !== 1) {
                $lines[] = $line;
            }
        }

        $salary = $this->firstMatch($lines, self::SALARY, 60);
        $location = $this->firstMatch($lines, self::LOCATION, 80);
        $company = collect($lines)->first(fn (string $line): bool => $line !== $salary && $line !== $location
            && mb_strlen($line) >= 2 && mb_strlen($line) <= 120 && preg_match('/^(đăng|posted|hôm nay|today|\d+\s*(giờ|ngày|hour|day))/iu', $line) !== 1);

        return new ParsedAlertJob($url, $title, $company, $location, $salary);
    }

    /**
     * Longest non-call-to-action text among all anchors pointing at the same job.
     *
     * @param  list<array{0: DOMElement, 1: string}>  $anchors
     */
    private function title(DOMXPath $xpath, string $url, array $anchors): ?string
    {
        $best = null;

        foreach ($anchors as [$anchor, $anchorUrl]) {
            $text = $this->clean($this->visibleText($xpath, $anchor));

            if ($anchorUrl === $url && mb_strlen($text) >= 3 && preg_match(self::CALL_TO_ACTION, $text) !== 1
                && ($best === null || mb_strlen($text) > mb_strlen($best))) {
                $best = $text;
            }
        }

        return $best === null ? null : Str::limit($best, self::TEXT_LIMIT, '');
    }

    private function visibleText(DOMXPath $xpath, DOMNode $node): string
    {
        $parts = [];

        foreach ($xpath->query('.//text()[not(ancestor::style) and not(ancestor::script)]', $node) ?: [] as $text) {
            $parts[] = (string) $text->nodeValue;
        }

        return implode(' ', $parts);
    }

    /**
     * Highest ancestor (max 8 levels, never body/html) that still holds links to this job only.
     *
     * @param  array{link_hosts: list<string>, job_path: string}  $profile
     */
    private function container(DOMXPath $xpath, DOMElement $anchor, string $url, array $profile): DOMNode
    {
        $node = $anchor;

        for ($depth = 0; $depth < 8; $depth++) {
            $parent = $node->parentNode;

            if (! $parent instanceof DOMElement || in_array(Str::lower($parent->tagName), ['body', 'html'], true)) {
                break;
            }

            foreach ($xpath->query('.//a[@href]', $parent) ?: [] as $link) {
                $other = $link instanceof DOMElement ? $this->normalizer->normalize($link->getAttribute('href'), $profile) : null;

                if ($other !== null && $other !== $url) {
                    return $node;
                }
            }

            $node = $parent;
        }

        return $node;
    }

    /** @param list<string> $lines */
    private function firstMatch(array $lines, string $pattern, int $maxLength): ?string
    {
        foreach ($lines as $line) {
            if (mb_strlen($line) <= $maxLength && preg_match($pattern, $line) === 1) {
                return Str::limit($line, self::TEXT_LIMIT, '');
            }
        }

        return null;
    }

    private function clean(string $text): string
    {
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5);
        $text = preg_replace('/[\p{C}\x{00A0}\x{200B}-\x{200F}\x{FEFF}\s]+/u', ' ', $text) ?? '';

        return trim($text);
    }

    private function load(string $html): ?DOMDocument
    {
        if (trim($html) === '') {
            return null;
        }

        $previous = libxml_use_internal_errors(true);
        $document = new DOMDocument;
        $loaded = $document->loadHTML('<?xml encoding="utf-8" ?>'.$html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        return $loaded ? $document : null;
    }
}
