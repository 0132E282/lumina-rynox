<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\Setting;
use Google\Client;
use Google\Service\SearchConsole;
use Google\Service\SearchConsole\InspectUrlIndexRequest;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * * Search Console URL Inspection API — the only way to ask Google whether a URL is indexed.
 * * Settings page values (credentials stored on the private disk) override `services.google_search_console`.
 */
class GoogleSearchConsoleService
{
    public function configured(): bool
    {
        return (bool) ($this->credentialsPath() && $this->siteUrl());
    }

    protected function credentialsPath(): ?string
    {
        $uploaded = Setting::get('google_search_console.credentials_path');

        if ($uploaded && Storage::disk('local')->exists($uploaded)) {
            return Storage::disk('local')->path($uploaded);
        }

        $configured = config('services.google_search_console.credentials_path');

        return $configured && is_file($configured) ? $configured : null;
    }

    protected function siteUrl(): ?string
    {
        return Setting::get('google_search_console.site_url') ?: config('services.google_search_console.site_url');
    }

    /**
     * @return array{
     *     indexed: bool,
     *     verdict: string,
     *     coverageState: ?string,
     *     lastCrawlTime: ?string,
     *     robotsTxtState: ?string,
     *     indexingState: ?string,
     *     sitemap: array,
     * }
     */
    public function inspect(string $url): array
    {
        if (! $this->configured()) {
            throw new RuntimeException('Google Search Console is not configured — set it up at /settings/search-console.');
        }

        $client = new Client;
        $client->setAuthConfig($this->credentialsPath());
        $client->setScopes([SearchConsole::WEBMASTERS_READONLY]);

        $service = new SearchConsole($client);

        $request = new InspectUrlIndexRequest([
            'inspectionUrl' => $url,
            'siteUrl' => $this->siteUrl(),
        ]);

        $response = $service->urlInspection_index->inspect($request);
        $result = $response->getInspectionResult()->getIndexStatusResult();

        return [
            'indexed' => $result->getVerdict() === 'PASS',
            'verdict' => (string) $result->getVerdict(),
            'coverageState' => $result->getCoverageState(),
            'lastCrawlTime' => $result->getLastCrawlTime(),
            'robotsTxtState' => $result->getRobotsTxtState(),
            'indexingState' => $result->getIndexingState(),
            'sitemap' => $result->getSitemap() ?? [],
        ];
    }
}
