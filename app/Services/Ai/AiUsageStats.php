<?php

declare(strict_types=1);

namespace App\Services\Ai;

use App\Models\AiAccount;
use App\Models\AiMessage;
use App\Models\AiUsageLog;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;

/**
 * Per-account usage for the "Thống kê AI" dialog, from `ai_usage_logs` in three grouped queries (no per-account query):
 * the call counts are the signed-in person's own; the status comes from every call of the account, because a quota stop is a fact about the account.
 * There is no real limit/budget data from the vendors, so none is shown: "quota" means only that the latest quota error is newer than the latest success.
 */
final class AiUsageStats
{
    private const CACHE_SECONDS = 60;

    /**
     * @return array{available: bool, accounts: list<array<string, mixed>>, history: array{replies_24h: int, replies_7d: int}}
     */
    public function forUser(int $userId): array
    {
        return Cache::remember("ai-usage:{$userId}", self::CACHE_SECONDS, fn (): array => $this->build($userId));
    }

    /** @return array{available: bool, accounts: list<array<string, mixed>>, history: array{replies_24h: int, replies_7d: int}} */
    private function build(int $userId): array
    {
        $history = $this->history($userId);
        $accounts = AiAccount::query()->orderBy('priority')->orderBy('id')->get();

        try {
            $now = Carbon::now();
            $dayAgo = $now->copy()->subDay();

            $own = AiUsageLog::query()
                ->where('user_id', $userId)
                ->where('created_at', '>=', $now->copy()->subDays(7))
                ->selectRaw('ai_account_id, COUNT(*) as calls_7d, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as calls_24h, MAX(created_at) as last_used_at, SUM(CASE WHEN created_at >= ? THEN COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0) ELSE 0 END) as tokens_24h, SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)) as tokens_7d, MAX(tokens_in) as largest_request', [$dayAgo, $dayAgo])
                ->groupBy('ai_account_id')
                ->get()
                ->keyBy('ai_account_id');

            $overall = AiUsageLog::query()
                ->selectRaw("ai_account_id, MAX(id) as last_id, MAX(CASE WHEN status = 'quota' THEN id END) as last_quota_id, MAX(CASE WHEN status = 'ok' THEN created_at END) as last_ok_at, MAX(CASE WHEN status = 'quota' THEN created_at END) as last_quota_at, MAX(CASE WHEN status = 'error' THEN created_at END) as last_error_at")
                ->groupBy('ai_account_id')
                ->get()
                ->keyBy('ai_account_id');

            $used = AiUsageLog::query()
                ->where('user_id', $userId)
                ->where('created_at', '>=', $now->copy()->subDays(7))
                ->whereNotNull('model')
                ->selectRaw('ai_account_id, model, COUNT(*) as calls')
                ->groupBy('ai_account_id', 'model')
                ->orderByDesc('calls')
                ->get()
                ->groupBy('ai_account_id');

            // * One query for both the latest call (its model) and the latest quota stop (its limit scope and reset time).
            $latest = AiUsageLog::query()
                ->whereIn('id', $overall->pluck('last_id')->merge($overall->pluck('last_quota_id'))->filter()->unique()->values())
                ->get(['id', 'ai_account_id', 'model', 'limit_scope', 'limit_reset_at'])
                ->keyBy('id');
        } catch (QueryException) {
            // * The table is missing (migration not run yet): same as no data.
            return ['available' => false, 'accounts' => [], 'history' => $history];
        }

        return [
            'available' => true,
            'history' => $history,
            'accounts' => $accounts->map(function (AiAccount $account) use ($own, $overall, $latest, $used): array {
                $mine = $own->get($account->id);
                $all = $overall->get($account->id);
                [$status, $statusAt] = $this->status($account, $all?->last_ok_at, $all?->last_quota_at, $all?->last_error_at);

                return [
                    'id' => $account->id,
                    'name' => $account->name,
                    'vendor_key' => $account->vendor,
                    'vendor' => AiAccount::VENDORS[$account->vendor] ?? $account->vendor,
                    // * The model of the latest call, else the account's own.
                    'model' => $latest->get($all?->last_id)?->model ?? $account->model,
                    'enabled' => $account->enabled,
                    'calls_24h' => (int) ($mine?->calls_24h ?? 0),
                    'calls_7d' => (int) ($mine?->calls_7d ?? 0),
                    'last_used_at' => $this->iso($mine?->last_used_at),
                    // * Estimates from text length, not the vendor's own count; the context window is per request, not a quota.
                    'tokens_24h' => (int) ($mine?->tokens_24h ?? 0),
                    'tokens_7d' => (int) ($mine?->tokens_7d ?? 0),
                    'largest_request' => $mine?->largest_request === null ? null : (int) $mine->largest_request,
                    'context_window' => AiAssistant::CONTEXT_WINDOW_TOKENS,
                    'models_used' => $used->get($account->id)?->pluck('model')->values()->all() ?? [],
                    'status' => $status,
                    'status_at' => $this->iso($statusAt),
                    'limit' => $this->limit($all?->last_ok_at, $all?->last_quota_at, $latest->get($all?->last_quota_id)),
                ];
            })->values()->all(),
        ];
    }

    /**
     * The limit state of every account (two grouped queries), for the accounts table. Account-wide like the status: a quota stop is a fact about the account, whoever hit it.
     *
     * @return array<int, array{state: string, scope: string|null, reset_at: string|null}> by account id; empty before the table exists
     */
    public function limits(): array
    {
        try {
            $overall = AiUsageLog::query()
                ->selectRaw("ai_account_id, MAX(CASE WHEN status = 'quota' THEN id END) as last_quota_id, MAX(CASE WHEN status = 'ok' THEN created_at END) as last_ok_at, MAX(CASE WHEN status = 'quota' THEN created_at END) as last_quota_at")
                ->groupBy('ai_account_id')
                ->get();
            $rows = AiUsageLog::query()->whereIn('id', $overall->pluck('last_quota_id')->filter()->values())->get(['id', 'limit_scope', 'limit_reset_at'])->keyBy('id');
        } catch (QueryException) {
            return [];
        }

        $limits = [];

        foreach ($overall as $row) {
            $limits[(int) $row->ai_account_id] = $this->limit($row->last_ok_at, $row->last_quota_at, $rows->get($row->last_quota_id));
        }

        return $limits;
    }

    /**
     * Limited only while the latest quota stop is newer than the latest success and its stated reset time is unknown or still ahead. Scope and reset time come from the real error only.
     *
     * @return array{state: string, scope: string|null, reset_at: string|null}
     */
    private function limit(mixed $lastOk, mixed $lastQuota, ?AiUsageLog $row): array
    {
        $none = ['state' => 'ok', 'scope' => null, 'reset_at' => null];

        if ($lastQuota === null || $row === null || ($lastOk !== null && $this->at($lastOk) >= $this->at($lastQuota))) {
            return $none;
        }

        $reset = $row->limit_reset_at;

        if ($reset !== null && $reset->lte(Carbon::now())) {
            return $none;
        }

        return ['state' => 'limited', 'scope' => $row->limit_scope, 'reset_at' => $reset?->toIso8601String()];
    }

    /**
     * The person's assistant replies already stored in the chat history. The history keeps no account or model, so these only fill the gap before the usage log has its own rows (they are not split per account).
     *
     * @return array{replies_24h: int, replies_7d: int}
     */
    private function history(int $userId): array
    {
        $now = Carbon::now();
        $row = AiMessage::query()
            ->join('ai_conversations', 'ai_conversations.id', '=', 'ai_messages.ai_conversation_id')
            ->where('ai_conversations.user_id', $userId)
            ->where('ai_messages.role', AiMessage::ROLE_ASSISTANT)
            ->where('ai_messages.created_at', '>=', $now->copy()->subDays(7))
            ->selectRaw('COUNT(*) as replies_7d, SUM(CASE WHEN ai_messages.created_at >= ? THEN 1 ELSE 0 END) as replies_24h', [$now->copy()->subDay()])
            ->first();

        return ['replies_24h' => (int) ($row?->replies_24h ?? 0), 'replies_7d' => (int) ($row?->replies_7d ?? 0)];
    }

    /**
     * `quota` only while the latest quota error is newer than the latest success; `error` likewise for other errors; `unused` with no call yet.
     *
     * @return array{0: string, 1: mixed}
     */
    private function status(AiAccount $account, mixed $lastOk, mixed $lastQuota, mixed $lastError): array
    {
        if (! $account->enabled) {
            return ['disabled', null];
        }

        $newer = fn (mixed $failure): bool => $failure !== null && ($lastOk === null || $this->at($failure) > $this->at($lastOk));

        return match (true) {
            $newer($lastQuota) && ($lastError === null || $this->at($lastQuota) >= $this->at($lastError)) => ['quota', $lastQuota],
            $newer($lastError) || $newer($lastQuota) => ['error', $lastError ?? $lastQuota],
            $lastOk !== null => ['active', $lastOk],
            default => ['unused', null],
        };
    }

    private function at(mixed $value): Carbon
    {
        return Carbon::parse($value);
    }

    private function iso(mixed $value): ?string
    {
        return $value === null ? null : $this->at($value)->toIso8601String();
    }
}
