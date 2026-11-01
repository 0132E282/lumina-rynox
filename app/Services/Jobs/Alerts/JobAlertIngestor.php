<?php

declare(strict_types=1);

namespace App\Services\Jobs\Alerts;

use App\Models\JobPosting;
use App\Models\Mailbox;
use App\Models\MailMessage;
use App\Models\Setting;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Reads job-alert mails that the Mail module has already cached (`mail_messages`, inbox only) and upserts their jobs into
 * `job_postings` with `meta.via = email`. Read-only towards mail: no IMAP connection, no flag change, no sending.
 *
 * Idempotent: rows are keyed by (source, url) and a repeat only refreshes `last_seen_at`, so `application_status`, `note`
 * and the first values of a posting are never overwritten. Messages are processed oldest first so `last_seen_at` ends at the newest mail.
 */
class JobAlertIngestor
{
    public const SETTING_KEY = 'jobs.alerts.last_run';

    public const STATUS_OK = 'ok';

    public const STATUS_NO_MAILBOX = 'no_mailbox';

    private const BODY_CHUNK = 25;

    private const UPSERT_CHUNK = 200;

    private const TEXT_LIMIT = 255;

    public function __construct(
        private readonly AlertSources $sources,
        private readonly JobAlertParser $parser,
    ) {}

    /**
     * @return array{status: string, message: string, at: string, messages: int, jobs: int, by_source: array<string, int>}
     */
    public function run(): array
    {
        $mailboxIds = Mailbox::query()->where('status', Mailbox::STATUS_CONNECTED)->pluck('id');

        if ($mailboxIds->isEmpty()) {
            return $this->remember(self::STATUS_NO_MAILBOX, 'Chưa có hộp thư nào được kết nối.', 0, []);
        }

        $ids = $this->messageQuery($mailboxIds->values()->map(fn ($id): int => (int) $id)->all())
            ->orderByDesc('received_at')->orderByDesc('id')
            ->limit((int) config('jobs.alerts.max_messages'))
            ->pluck('id')->reverse()->values()->all();

        $found = [];
        $withoutJobs = 0;
        $withoutBody = 0;

        foreach (array_chunk($ids, self::BODY_CHUNK) as $chunk) {
            $messages = MailMessage::query()->whereIn('id', $chunk)
                ->get(['id', 'from_email', 'body_html', 'received_at', 'sent_at', 'created_at'])
                ->sortBy(fn (MailMessage $message): int => (int) array_search($message->id, $chunk, true));

            foreach ($messages as $message) {
                $count = $this->collect($message, $found, $withoutBody);
                $withoutJobs += $count === 0 ? 1 : 0;
            }
        }

        $this->store($found);
        $bySource = array_count_values(array_map(fn (array $row): string => $row['source'], $found));
        $note = $withoutJobs + $withoutBody > 0
            ? " ({$withoutJobs} email không nhận ra việc làm nào, {$withoutBody} email chưa có nội dung đã lưu)"
            : '';

        return $this->remember(self::STATUS_OK, 'Đã đọc '.count($ids).' email job-alert, nhập '.count($found).' việc làm.'.$note, count($ids), $bySource, count($found));
    }

    /**
     * @param  array<string, array<string, mixed>>  $found
     * @return int number of jobs found in this message
     */
    private function collect(MailMessage $message, array &$found, int &$withoutBody): int
    {
        $source = $this->sources->resolveSender($message->from_email);

        if ($source === null) {
            return 0;
        }

        if (! is_string($message->body_html) || $message->body_html === '') {
            $withoutBody++;

            return 1;
        }

        try {
            $jobs = $this->parser->parse($message->body_html, $this->sources->all()[$source]);
        } catch (Throwable $exception) {
            Log::warning('Job alert mail could not be parsed', ['mail_message_id' => $message->id, 'source' => $source, 'error' => $exception->getMessage()]);

            return 0;
        }

        $seenAt = $message->received_at ?? $message->sent_at ?? $message->created_at ?? now();

        foreach ($jobs as $job) {
            $found[$source.'|'.$job->url] = [
                'source' => $source,
                'external_id' => null,
                'url' => $job->url,
                'title' => mb_substr($job->title, 0, self::TEXT_LIMIT),
                'company' => $job->company,
                'location' => $job->location,
                'salary_text' => $job->salaryText,
                'tags' => json_encode([]),
                'posted_at' => null,
                'meta' => json_encode(['via' => 'email']),
                'first_seen_at' => $seenAt,
                'last_seen_at' => $seenAt,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        return count($jobs);
    }

    /** @param array<string, array<string, mixed>> $found */
    private function store(array $found): void
    {
        // * Only `last_seen_at`/`updated_at` change on a repeat: status, note, first_seen_at and the first parsed values stay as they were.
        foreach (array_chunk(array_values($found), self::UPSERT_CHUNK) as $chunk) {
            JobPosting::query()->upsert($chunk, ['source', 'url'], ['last_seen_at', 'updated_at']);
        }
    }

    /**
     * @param  array<int, int>  $mailboxIds
     * @return Builder<MailMessage>
     */
    private function messageQuery(array $mailboxIds): Builder
    {
        $domains = $this->sources->senderDomains();

        return MailMessage::query()->inbox()
            ->whereIn('mailbox_id', $mailboxIds)
            ->where('received_at', '>=', now()->subDays((int) config('jobs.alerts.lookback_days')))
            ->where(function (Builder $query) use ($domains): void {
                foreach ($domains as $domain) {
                    $query->orWhere('from_email', 'like', '%@'.$domain)->orWhere('from_email', 'like', '%.'.$domain);
                }
            });
    }

    /**
     * @param  array<string, int>  $bySource
     * @return array{status: string, message: string, at: string, messages: int, jobs: int, by_source: array<string, int>}
     */
    private function remember(string $status, string $message, int $messages, array $bySource, int $jobs = 0): array
    {
        $result = ['status' => $status, 'message' => $message, 'at' => now()->toIso8601String(), 'messages' => $messages, 'jobs' => $jobs, 'by_source' => $bySource];
        Setting::set(self::SETTING_KEY, $result);

        return $result;
    }
}
