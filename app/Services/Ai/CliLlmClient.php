<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Symfony\Component\Process\Exception\ExceptionInterface;

/**
 * * Runs the vendor CLI installed on this machine (`claude`, `codex`, `gemini`), already signed in by the user.
 * ! argv is an array (never a shell string) and the prompt goes through stdin, so chat text cannot become a command or an option.
 * ! The session token goes to the child process only as an environment variable: never argv (visible in `ps`), never logged.
 * ! Tools that write or run commands are switched off per CLI and the working directory is an empty fixed folder; stderr is never surfaced.
 */
final class CliLlmClient implements LlmClient
{
    private const TIMEOUT_SECONDS = 120;

    // * Only plain model ids may reach argv (no leading dash, so a model can never be read as an option).
    public const MODEL_PATTERN = '/^[A-Za-z0-9][A-Za-z0-9._:-]*$/';

    // * Vendor => environment variable the CLI reads its session from. Unverified against the real CLIs; a CLI that ignores it falls back to the machine's own login.
    private const TOKEN_ENV = [
        'anthropic' => 'CLAUDE_CODE_OAUTH_TOKEN',
        'openai' => 'CODEX_API_KEY',
        'google' => 'GEMINI_API_KEY',
    ];

    public function __construct(private readonly string $vendor, private readonly ?string $sessionToken, private readonly ?string $model = null) {}

    public function complete(string $system, string $prompt): string
    {
        $images = app(ChatImages::class)->paths();
        $body = $prompt.$this->imageNote($images);
        $lead = $this->leadNote();

        // * Streamed Claude chat: the first call may answer, or may only split a big job into agents (a JSON plan); each agent then runs its own Claude and may use its own subagents.
        $text = $this->invoke($system."\n\n".$body.$lead, $images, null);

        $agents = $lead === '' ? null : $this->agentPlan($text);

        return $agents === null ? $text : $this->orchestrate($system, $body, $images, $agents);
    }

    /**
     * Runs the agents of the plan side by side (each its own Claude process, its subagents hang under it in the chat), then asks Claude to put their results into one answer.
     *
     * @param  list<string>  $images
     * @param  list<array{role: string, task: string}>  $agents
     */
    private function orchestrate(string $system, string $body, array $images, array $agents): string
    {
        $activity = app(ChatActivity::class);
        [$command, $cliEnv] = CliRuntime::resolve($this->command($images));
        $directory = $this->directory();
        @set_time_limit(self::TIMEOUT_SECONDS * 2 + 15);

        $ids = [];
        $parsers = [];

        foreach ($agents as $index => $agent) {
            $ids[$index] = 'agent-'.($index + 1);
            $parsers[$ids[$index]] = new ClaudeStreamParser($activity, $ids[$index], app(AgentWorkspace::class)->path());
            $activity->agent(['id' => $ids[$index], 'parent' => null, 'role' => $agent['role'], 'task' => mb_substr($agent['task'], 0, 160), 'step' => '', 'status' => 'running']);
        }

        try {
            $results = Process::pool(function ($pool) use ($agents, $ids, $system, $body, $command, $cliEnv, $directory): void {
                foreach ($agents as $index => $agent) {
                    $pool->as($ids[$index])->path($directory)->timeout(self::TIMEOUT_SECONDS)->env($this->environment($cliEnv))
                        ->input($system."\n\n".$body."\n\nBạn là agent \"{$agent['role']}\" trong một nhóm. Chỉ làm phần việc sau và báo kết quả ngắn gọn, đủ ý; có thể giao việc nhỏ cho subagent của bạn bằng công cụ Task.\nViệc của bạn: {$agent['task']}")
                        ->command($command);
                }
            })->start(function (string $type, string $output, string $key) use ($parsers): void {
                if ($type === 'out' && isset($parsers[$key])) {
                    $parsers[$key]->feed($output);
                }
            })->wait();
        } catch (ProcessTimedOutException) {
            throw new AiException(AiException::TIMEOUT, null, 'CLI '.$this->vendor.' chạy quá '.self::TIMEOUT_SECONDS.' giây');
        } catch (ExceptionInterface) {
            throw new AiException(AiException::CLI_NOT_FOUND);
        }

        $reports = [];

        foreach ($agents as $index => $agent) {
            $id = $ids[$index];
            $result = $results[$id];
            $text = $result->failed() ? null : trim($parsers[$id]->result() ?? $result->output());
            $text = $text === '' ? null : $text;

            $activity->agent(['id' => $id, 'step' => $text === null ? 'Lỗi, không có kết quả' : 'Đã xong', 'status' => 'done']);
            $reports[] = "### {$agent['role']}: {$agent['task']}\n".($text ?? '(agent này không trả được kết quả)');
        }

        return $this->invoke($system."\n\n".$body."\n\nCác agent đã làm xong phần của mình:\n\n".implode("\n\n", $reports)."\n\nHãy tổng hợp thành một câu trả lời cuối cùng cho người dùng, không nhắc tới việc chia agent.", $images, null);
    }

    /**
     * One Claude/Codex/Gemini call: the text it answered, or an AiException.
     *
     * @param  list<string>  $images
     */
    private function invoke(string $input, array $images, ?string $agentId): string
    {
        [$command, $cliEnv] = CliRuntime::resolve($this->command($images));
        $directory = $this->directory();

        // * PHP's own max_execution_time (30 s by default) would cut the request before the CLI's own timeout does.
        @set_time_limit(self::TIMEOUT_SECONDS + 15);

        $stream = $this->vendor === 'anthropic' ? new ClaudeStreamParser(app(ChatActivity::class), $agentId, app(AgentWorkspace::class)->path()) : null;

        try {
            $result = Process::path($directory)
                ->timeout(self::TIMEOUT_SECONDS)
                ->env($this->environment($cliEnv))
                ->input($input)
                ->run($command, $stream === null ? null : function (string $type, string $output) use ($stream): void {
                    if ($type === 'out') {
                        $stream->feed($output);
                    }
                });
        } catch (ProcessTimedOutException) {
            throw new AiException(AiException::TIMEOUT, null, 'CLI '.$this->vendor.' chạy quá '.self::TIMEOUT_SECONDS.' giây');
        } catch (ExceptionInterface) {
            throw new AiException(AiException::CLI_NOT_FOUND);
        }

        if ($result->failed() || $this->notLoggedIn($stream?->result() ?? $result->output())) {
            // * Only a fixed pattern of the CLI's own output is looked at; its text is never shown, stored or logged.
            $output = $result->output().$result->errorOutput();

            $quota = $this->quotaHit($output);

            throw new AiException(match (true) {
                $this->notLoggedIn($output) => AiException::CLI_NOT_LOGGED_IN,
                $quota => AiException::QUOTA,
                $result->exitCode() === 127 => AiException::CLI_NOT_FOUND,
                default => AiException::CLI_UNAVAILABLE,
            }, $quota ? QuotaLimit::parse($output) : null, 'CLI '.$this->vendor.' thoát với mã '.$result->exitCode());
        }

        // * Claude answers in stream-json: its `result` line is the text; any other output (older CLI) is the text itself.
        $text = trim($stream?->result() ?? $result->output());

        if ($text === '') {
            throw new AiException(AiException::EMPTY);
        }

        return $text;
    }

    private function directory(): string
    {
        // * An approved plan on a cloned GitHub repo works inside that clone.
        $directory = app(AgentWorkspace::class)->path() ?? storage_path('app/ai-cli');
        File::ensureDirectoryExists($directory);

        return $directory;
    }

    /**
     * @param  array<string, string>  $cliEnv
     * @return array<string, string>
     */
    private function environment(array $cliEnv): array
    {
        return [...($this->sessionToken === null || $this->sessionToken === '' ? [] : [self::TOKEN_ENV[$this->vendor] => $this->sessionToken]), ...$cliEnv];
    }

    /** The streamed Claude chat may split a big job into agents: the first call answers a small job as usual, or answers a big one with only a JSON plan. */
    private function leadNote(): string
    {
        if ($this->vendor !== 'anthropic' || ! app(ChatActivity::class)->showsPlan()) {
            return '';
        }

        return "\n\nNếu việc lớn, gồm nhiều phần độc lập (ví dụ viết code, review, test): KHÔNG làm ngay, chỉ trả đúng một khối JSON, không thêm chữ nào khác: {\"agents\":[{\"role\":\"coder\",\"task\":\"việc cụ thể của agent này\"}]} với 2 đến 3 agent, mỗi agent một vai trò và một phần việc riêng. Nếu tin nhắn có danh sách task kèm mã (như TASK-1), mỗi agent ghi rõ mã các task nó đảm nhận ở đầu trường task, ví dụ \"TASK-1, TASK-2: việc cụ thể\". Việc nhỏ hoặc câu hỏi thường thì trả lời bình thường.";
    }

    /**
     * The agents of a JSON plan answered by the first call, or null when it was an ordinary answer.
     *
     * @return list<array{role: string, task: string}>|null
     */
    private function agentPlan(string $text): ?array
    {
        $json = json_decode(trim((string) preg_replace('/^```(?:json)?\s*|\s*```$/i', '', trim($text))), true);

        if (! is_array($json) || ! is_array($json['agents'] ?? null)) {
            return null;
        }

        $agents = [];

        foreach (array_slice($json['agents'], 0, 3) as $agent) {
            $task = is_array($agent) && is_string($agent['task'] ?? null) ? trim($agent['task']) : '';
            $role = is_array($agent) && is_string($agent['role'] ?? null) ? preg_replace('/[^\p{L}\p{N} _-]/u', '', $agent['role']) : '';

            if ($task !== '') {
                $agents[] = ['role' => mb_substr(trim((string) $role) ?: 'agent', 0, 30), 'task' => mb_substr($task, 0, 600)];
            }
        }

        return $agents === [] ? null : $agents;
    }

    /** Only the CLI's own plain messages about a limit: `usage limit reached`, `rate limit`, `insufficient_quota`, `credit balance is too low`. */
    private function quotaHit(string $output): bool
    {
        return preg_match('~usage limit reached|(?:5-hour|weekly|daily|session|usage) limit reached|hit your (?:usage |session |weekly |daily )?limit|rate[ _-]?limit|insufficient_quota|credit balance (is )?too low~i', $output) === 1;
    }

    private function notLoggedIn(string $output): bool
    {
        return preg_match('~not logged in|please run /login|/login~i', $output) === 1;
    }

    /**
     * Claude and Gemini read a picture by its path; Codex takes it as an `--image` argument instead, so only those two are told the paths.
     *
     * @param  list<string>  $images
     */
    private function imageNote(array $images): string
    {
        if ($images === [] || $this->vendor === 'openai') {
            return '';
        }

        return "\n\nẢnh người dùng đính kèm (hãy mở từng ảnh bằng công cụ đọc tệp):\n".implode("\n", $images);
    }

    /**
     * @param  list<string>  $images  absolute paths of the pictures of this message
     * @return list<string>
     *
     * @throws AiException
     */
    private function command(array $images = []): array
    {
        $model = filled($this->model) && preg_match(self::MODEL_PATTERN, $this->model) === 1 ? $this->model : null;

        return match ($this->vendor) {
            // * Print mode reads the prompt from stdin; the tools that edit files, run commands or reach the web are denied.
            // * Inside a repo clone (an approved plan) file edits are allowed there and only there; commands and the web stay denied.
            'anthropic' => ['claude', '-p', '--output-format', 'stream-json', '--verbose', ...(app(AgentWorkspace::class)->path() === null ? ['--disallowedTools', 'Bash,Edit,MultiEdit,Write,NotebookEdit,WebFetch,WebSearch'] : ['--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash,WebFetch,WebSearch']), ...$this->mcpArguments(), ...($model === null ? [] : ['--model', $model])],
            // * `-` reads the prompt from stdin; the read-only sandbox blocks writes and commands that change anything.
            'openai' => ['codex', 'exec', ...array_map(fn (string $path): string => '--image='.$path, $images), '--sandbox', 'read-only', '--skip-git-repo-check', ...($model === null ? [] : ['--model', $model]), '-'],
            // * The stdin text is appended to this fixed instruction.
            'google' => ['gemini', '-p', 'Trả lời đúng theo hướng dẫn và khối dữ liệu nhận qua stdin.', ...($model === null ? [] : ['--model', $model])],
            default => throw new AiException(AiException::CLI_UNSUPPORTED),
        };
    }

    /**
     * * No MCP server unless the person switched it on for the picked project: with none on, the CLI loads none at all; otherwise every other known server is denied by name.
     *
     * @return list<string>
     */
    private function mcpArguments(): array
    {
        $allowed = app(McpPolicy::class)->allowed();

        if ($allowed === []) {
            return ['--strict-mcp-config'];
        }

        $denied = collect(app(ProjectTools::class)->mcpServers())->pluck('name')->diff($allowed)->map(fn (string $name): string => 'mcp__'.preg_replace('/[^A-Za-z0-9_-]/', '_', $name))->values()->all();

        return $denied === [] ? [] : ['--disallowedTools', implode(',', $denied)];
    }
}
