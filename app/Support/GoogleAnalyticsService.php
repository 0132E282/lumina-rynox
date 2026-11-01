<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\Setting;
use DateTimeImmutable;
use Google\Client;
use Google\Service\AnalyticsData;
use Google\Service\AnalyticsData\BatchRunReportsRequest;
use Google\Service\AnalyticsData\DateRange;
use Google\Service\AnalyticsData\Dimension;
use Google\Service\AnalyticsData\Metric;
use Google\Service\AnalyticsData\MetricOrderBy;
use Google\Service\AnalyticsData\OrderBy;
use Google\Service\AnalyticsData\RunReportRequest;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class GoogleAnalyticsService
{
    public function configured(): bool
    {
        return $this->propertyId() !== null && $this->credentialsPath() !== null;
    }

    public function propertyId(): ?string
    {
        $propertyId = Setting::get('google_analytics.property_id') ?: config('services.google_analytics.property_id');

        return is_string($propertyId) && preg_match('/^\d+$/', $propertyId) === 1 ? $propertyId : null;
    }

    /**
     * @return array{
     *     summary: array{uniqueVisitors: int, pageViews: int, bounceRate: float, averageSessionDuration: float},
     *     trend: list<array{date: string, visitors: int, pageViews: int}>,
     *     sources: list<array{name: string, sessions: int}>,
     *     pages: list<array{name: string, views: int}>,
     *     devices: list<array{name: string, sessions: int}>
     * }
     */
    public function dashboard(): array
    {
        $propertyId = $this->propertyId();
        $credentialsPath = $this->credentialsPath();

        if (! $propertyId || ! $credentialsPath) {
            throw new RuntimeException('Google Analytics is not configured.');
        }

        $client = new Client;
        $client->setAuthConfig($credentialsPath);
        $client->setScopes([AnalyticsData::ANALYTICS_READONLY]);

        $analytics = new AnalyticsData($client);
        $reports = $analytics->properties->batchRunReports(
            "properties/{$propertyId}",
            new BatchRunReportsRequest([
                'requests' => [
                    $this->report(['totalUsers', 'screenPageViews', 'bounceRate', 'averageSessionDuration']),
                    $this->report(['activeUsers', 'screenPageViews'], ['date']),
                    $this->report(['sessions'], ['sessionSource'], 5, 'sessions'),
                    $this->report(['screenPageViews'], ['pagePath'], 5, 'screenPageViews'),
                    $this->report(['sessions'], ['deviceCategory'], 5, 'sessions'),
                ],
            ]),
        )->getReports() ?? [];

        $summaryRow = $reports[0]->getRows()[0] ?? null;
        $summaryValues = $summaryRow?->getMetricValues() ?? [];

        return [
            'summary' => [
                'uniqueVisitors' => (int) ($summaryValues[0]->getValue() ?? 0),
                'pageViews' => (int) ($summaryValues[1]->getValue() ?? 0),
                'bounceRate' => (float) ($summaryValues[2]->getValue() ?? 0) * 100,
                'averageSessionDuration' => (float) ($summaryValues[3]->getValue() ?? 0),
            ],
            'trend' => array_values(array_filter(array_map(function ($row): ?array {
                $rawDate = $row->getDimensionValues()[0]->getValue() ?? '';
                $date = DateTimeImmutable::createFromFormat('!Ymd', $rawDate);

                if (! $date) {
                    return null;
                }

                $values = $row->getMetricValues();

                return [
                    'date' => $date->format('Y-m-d'),
                    'visitors' => (int) ($values[0]->getValue() ?? 0),
                    'pageViews' => (int) ($values[1]->getValue() ?? 0),
                ];
            }, $reports[1]->getRows() ?? []))),
            'sources' => $this->rows($reports[2]->getRows() ?? [], 'sessions'),
            'pages' => $this->rows($reports[3]->getRows() ?? [], 'views'),
            'devices' => $this->rows($reports[4]->getRows() ?? [], 'sessions'),
        ];
    }

    protected function credentialsPath(): ?string
    {
        $uploaded = Setting::get('google_analytics.credentials_path');

        if ($uploaded && Storage::disk('local')->exists($uploaded)) {
            return Storage::disk('local')->path($uploaded);
        }

        $configured = config('services.google_analytics.credentials_path');

        return $configured && is_file($configured) ? $configured : null;
    }

    /** @param list<string> $metrics
     * @param  list<string>  $dimensions
     */
    private function report(array $metrics, array $dimensions = [], int $limit = 100, ?string $orderBy = null): RunReportRequest
    {
        $request = new RunReportRequest([
            'dateRanges' => [new DateRange(['startDate' => '30daysAgo', 'endDate' => 'yesterday'])],
            'metrics' => array_map(fn (string $name) => new Metric(['name' => $name]), $metrics),
            'dimensions' => array_map(fn (string $name) => new Dimension(['name' => $name]), $dimensions),
            'limit' => (string) $limit,
        ]);

        if ($orderBy) {
            $request->setOrderBys([
                new OrderBy([
                    'metric' => new MetricOrderBy(['metricName' => $orderBy]),
                    'desc' => true,
                ]),
            ]);
        }

        return $request;
    }

    /** @param array<int, mixed> $rows
     * @return list<array{name: string, sessions?: int, views?: int}>
     */
    private function rows(array $rows, string $valueKey): array
    {
        return array_values(array_map(static function ($row) use ($valueKey): array {
            return [
                'name' => (string) ($row->getDimensionValues()[0]->getValue() ?? ''),
                $valueKey => (int) ($row->getMetricValues()[0]->getValue() ?? 0),
            ];
        }, $rows));
    }
}
