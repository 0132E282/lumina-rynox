<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * One AI login the assistant may use. `api_token` calls the vendor HTTP API; `session_token` hands the token to the vendor CLI.
 *
 * @property int $id
 * @property string $name
 * @property string $vendor `anthropic|openai|google|deepseek`
 * @property string $auth_type `api_token|session_token`
 * @property array{token?: string}|null $credentials
 * @property string|null $model
 * @property bool $enabled
 * @property string $status `connected|error|disconnected`
 * @property string|null $last_error
 * @property Carbon|null $last_checked_at
 * @property list<string>|null $purposes null = every purpose
 * @property int $priority lower runs first
 */
class AiAccount extends Model
{
    public const AUTH_API = 'api_token';

    public const AUTH_SESSION = 'session_token';

    public const AUTH_TYPES = [self::AUTH_API => 'API token', self::AUTH_SESSION => 'Session token (CLI)'];

    public const VENDORS = [
        'anthropic' => 'Claude (Anthropic)',
        'openai' => 'OpenAI / Codex',
        'google' => 'Gemini (Google)',
        'deepseek' => 'DeepSeek',
    ];

    // * Models the chat picker offers per vendor. Only ids that are known to exist are listed; any other vendor offers just the model set on the account.
    public const VENDOR_MODELS = [
        'anthropic' => [
            'claude-fable-5-1' => 'Fable 5.1',
            'claude-opus-5-5' => 'Opus 5.5',
            'claude-sonnet-5-5' => 'Sonnet 5.5',
            'claude-haiku-5-5' => 'Haiku 5.5',
        ],
    ];

    public const PURPOSE_SUGGEST_REPLY = 'suggest_reply';

    public const PURPOSE_REPORT = 'report';

    public const PURPOSE_POST_DRAFT = 'post_draft';

    public const PURPOSE_ASK = 'ask';

    public const PURPOSE_JOB_MATCH = 'job_match';

    public const PURPOSES = [
        self::PURPOSE_SUGGEST_REPLY => 'Gợi ý trả lời khách',
        self::PURPOSE_REPORT => 'Báo cáo',
        self::PURPOSE_POST_DRAFT => 'Viết bài nháp',
        self::PURPOSE_ASK => 'Hỏi đáp (thanh bên phải)',
        self::PURPOSE_JOB_MATCH => 'Chấm việc làm phù hợp CV',
    ];

    protected $fillable = [
        'name',
        'vendor',
        'auth_type',
        'credentials',
        'model',
        'enabled',
        'status',
        'last_error',
        'last_checked_at',
        'purposes',
        'priority',
    ];

    // ! The token never leaves the server: `credentials` is hidden and only `maskedToken()` reaches the client.
    protected $hidden = ['credentials'];

    protected $casts = [
        'credentials' => 'encrypted:array',
        'enabled' => 'boolean',
        'purposes' => 'array',
        'last_checked_at' => 'datetime',
        'priority' => 'integer',
    ];

    public function token(): ?string
    {
        $token = $this->credentials['token'] ?? null;

        return is_string($token) && $token !== '' ? $token : null;
    }

    public function maskedToken(): ?string
    {
        $token = $this->token();

        return $token === null ? null : Integration::mask($token);
    }

    public function allowsPurpose(string $purpose): bool
    {
        return $this->purposes === null || in_array($purpose, $this->purposes, true);
    }

    /**
     * Models the chat picker offers for this account: the vendor's list, plus the model pinned on the account when it is not in that list.
     *
     * @return array<string, string> id => label
     */
    public function pickableModels(): array
    {
        $models = self::VENDOR_MODELS[$this->vendor] ?? [];

        if (filled($this->model) && ! isset($models[$this->model])) {
            $models = [$this->model => $this->model] + $models;
        }

        return $models;
    }
}
