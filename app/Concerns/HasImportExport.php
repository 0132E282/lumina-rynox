<?php

declare(strict_types=1);

namespace App\Concerns;

use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Csv;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

trait HasImportExport
{
    /** * `ids[]` (rows resolved client-side) takes priority over a fresh filtered query. */
    public function export(Request $request, string $resource): StreamedResponse
    {
        $modelClass = $this->resolveModelClass($resource);
        $ids = array_filter((array) $request->query('ids', []));

        if ($ids !== []) {
            $rows = $modelClass::query()->whereIn('id', $ids)->get();
        } else {
            $result = $modelClass::query()->applyQuery(array_merge($this->queryParams($request), ['limit' => -1]));
            $rows = $result instanceof Collection || $result instanceof EloquentCollection
                ? $result
                : collect($result->items());
        }

        $fields = array_values(array_filter((array) $request->query('fields', [])));

        $data = $rows->map(function ($row) use ($fields) {
            $attributes = $row->toArray();
            $attributes = $fields !== [] ? collect($attributes)->only($fields)->all() : $attributes;

            return collect($attributes)->map(fn ($value) => $this->resolveExportValue($value))->all();
        });

        return match ($request->query('format', 'json')) {
            'xlsx' => $this->streamSpreadsheet($data, $resource, Xlsx::class, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
            'csv' => $this->streamSpreadsheet($data, $resource, Csv::class, 'csv', 'text/csv'),
            default => response()->streamDownload(function () use ($data) {
                echo $data->values()->toJson();
            }, "{$resource}-".now()->format('Y-m-d-His').'.json', ['Content-Type' => 'application/json']),
        };
    }

    /** * File fields store storage-relative paths; export them as absolute URLs. */
    protected function resolveExportValue(mixed $value): mixed
    {
        if (is_string($value) && ! str_starts_with($value, 'http') && preg_match('/\.(jpe?g|png|gif|webp|svg|pdf|docx?|xlsx?|zip)$/i', $value)) {
            return url(Str::start($value, '/'));
        }

        return $value;
    }

    protected function streamSpreadsheet(Collection $rows, string $resource, string $writerClass, string $extension, string $contentType): StreamedResponse
    {
        $rows = $rows->values();
        $headers = $rows->isNotEmpty() ? array_keys($rows->first()) : [];

        $spreadsheet = new Spreadsheet;
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->fromArray($headers, null, 'A1');
        $sheet->fromArray($rows->map(fn ($row) => array_values($row))->all(), null, 'A2');

        return response()->streamDownload(function () use ($spreadsheet, $writerClass) {
            (new $writerClass($spreadsheet))->save('php://output');
        }, "{$resource}-".now()->format('Y-m-d-His').".{$extension}", ['Content-Type' => $contentType]);
    }

    public function import(Request $request, string $resource): JsonResponse
    {
        $modelClass = $this->resolveModelClass($resource);

        $request->validate(['file' => ['required', 'file']]);

        $rows = json_decode($request->file('file')->get(), true) ?? [];

        $imported = 0;
        $failed = 0;

        foreach ($rows as $row) {
            if (! is_array($row)) {
                $failed++;

                continue;
            }

            try {
                $modelClass::create($row);
                $imported++;
            } catch (Throwable) {
                $failed++;
            }
        }

        return response()->json(['imported' => $imported, 'failed' => $failed]);
    }
}
