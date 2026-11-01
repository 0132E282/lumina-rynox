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
        [$command, $cliEnv] = CliRuntime::resolve($this->command());
        $directory = storage_path('app/ai-cli');
        File::ensureDirectoryExists($directory);

        // * PHP's own max_execution_time (30 s by default) would cut the request before the CLI's own timeout does.
        @set_time_limit(self::TIMEOUT_SECONDS + 15);

        try {
            $result = Process::path($directory)
                ->timeout(self::TIMEOUT_SECONDS)
                ->env([...($this->sessionToken === null || $this->sessionToken === '' ? [] : [self::TOKEN_ENV[$this->vendor] => $this->sessionToken]), ...$cliEnv])
                ->input($system."\n\n".$prompt)
                ->run($command);
        } catch (ProcessTimedOutException) {
            throw new AiException(AiException::TIMEOUT);
        } catch (ExceptionInterface) {
            throw new AiException(AiException::CLI_NOT_FOUND);
        }

        if ($result->failed() || $this->notLoggedIn($result->output())) {
            // * Only a fixed pattern of the CLI's own output is looked at; its text is never shown, stored or logged.
            $output = $result->output().$result->errorOutput();

            throw new AiException(match (true) {
                $this->notLoggedIn($output) => AiException::CLI_NOT_LOGGED_IN,
                $this->quotaHit($output) => AiException::QUOTA,
                $result->exitCode() === 127 => AiException::CLI_NOT_FOUND,
                default => AiException::CLI_UNAVAILABLE,
            }, $this->quotaHit($output) ? QuotaLimit::parse($output) : null);
        }

        $text = trim($result->output());

        if ($text === '') {
            throw new AiException(AiException::EMPTY);
        }

        return $text;
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
     * @return list<string>
     *
     * @throws AiException
     */
    private function command(): array
    {
        $model = filled($this->model) && preg_match(self::MODEL_PATTERN, $this->model) === 1 ? $this->model : null;

        return match ($this->vendor) {
            // * Print mode reads the prompt from stdin; the tools that edit files, run commands or reach the web are denied.
            'anthropic' => ['claude', '-p', '--output-format', 'text', '--disallowedTools', 'Bash,Edit,MultiEdit,Write,NotebookEdit,WebFetch,WebSearch', ...$this->mcpArguments(), ...($model === null ? [] : ['--model', $model])],
            // * `-` reads the prompt from stdin; the read-only sandbox blocks writes and commands that change anything.
            'openai' => ['codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', ...($model === null ? [] : ['--model', $model]), '-'],
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
