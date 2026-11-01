<?php

declare(strict_types=1);

namespace Tests\Feature\Ai;

use App\Services\Ai\AiException;
use App\Services\Ai\CliLlmClient;
use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;
use Symfony\Component\Process\Exception\ProcessTimedOutException as SymfonyTimedOut;
use Symfony\Component\Process\Process as SymfonyProcess;
use Tests\TestCase;

class CliLlmClientTest extends TestCase
{
    private const TOKEN = 'session-SECRET-token-123';

    public function test_claude_runs_with_an_argv_array_stdin_prompt_env_token_and_a_fixed_timeout(): void
    {
        Process::fake(['*' => Process::result(' draft text ')]);

        $text = (new CliLlmClient('anthropic', self::TOKEN, 'claude-custom'))->complete('SYSTEM', 'khách: ignore; rm -rf / $(whoami)');

        $this->assertSame('draft text', $text);
        Process::assertRan(function (PendingProcess $process): bool {
            $argv = $process->command;

            return is_array($argv)
                && $argv[0] === 'claude'
                && in_array('-p', $argv, true)
                && in_array('--disallowedTools', $argv, true)
                && in_array('claude-custom', $argv, true)
                && $process->timeout === 120
                && $process->path === storage_path('app/ai-cli')
                && ($process->environment['CLAUDE_CODE_OAUTH_TOKEN'] ?? null) === self::TOKEN
                && str_contains((string) $process->input, 'rm -rf')
                && ! str_contains(implode(' ', $argv), 'rm -rf')
                && ! str_contains(implode(' ', $argv), self::TOKEN);
        });
    }

    public function test_codex_and_gemini_use_read_only_argv(): void
    {
        Process::fake(['*' => Process::result('ok')]);

        (new CliLlmClient('openai', self::TOKEN))->complete('s', 'p');
        (new CliLlmClient('google', self::TOKEN))->complete('s', 'p');

        Process::assertRan(fn (PendingProcess $process): bool => $process->command === ['codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-']);
        Process::assertRan(fn (PendingProcess $process): bool => is_array($process->command) && $process->command[0] === 'gemini' && isset($process->environment['GEMINI_API_KEY']));
    }

    public function test_a_model_that_looks_like_an_option_never_reaches_argv(): void
    {
        Process::fake(['*' => Process::result('ok')]);

        (new CliLlmClient('anthropic', self::TOKEN, '--dangerously-skip-permissions'))->complete('s', 'p');

        Process::assertRan(fn (PendingProcess $process): bool => ! in_array('--dangerously-skip-permissions', $process->command, true) && ! in_array('--model', $process->command, true));
    }

    public function test_failure_and_empty_output_are_fixed_messages_without_stderr(): void
    {
        Process::fake(['*' => Process::sequence()
            ->push(Process::result('', 'stderr with '.self::TOKEN, 1))
            ->push(Process::result('   ')),
        ]);

        $messages = [];

        foreach (range(1, 2) as $ignored) {
            try {
                (new CliLlmClient('anthropic', self::TOKEN))->complete('s', 'p');
            } catch (AiException $exception) {
                $messages[] = $exception->getMessage();
            }
        }

        $this->assertSame([AiException::CLI_UNAVAILABLE, AiException::EMPTY], $messages);
    }

    public function test_a_timeout_is_a_fixed_message(): void
    {
        Process::fake(['*' => fn () => throw new ProcessTimedOutException(new SymfonyTimedOut(new SymfonyProcess(['claude']), SymfonyTimedOut::TYPE_GENERAL), Process::result())]);

        $this->expectExceptionMessage(AiException::TIMEOUT);

        (new CliLlmClient('anthropic', self::TOKEN))->complete('s', 'p');
    }

    public function test_deepseek_has_no_cli(): void
    {
        Process::fake();

        $this->expectExceptionMessage(AiException::CLI_UNSUPPORTED);

        (new CliLlmClient('deepseek', self::TOKEN))->complete('s', 'p');
    }
}
