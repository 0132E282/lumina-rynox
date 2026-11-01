<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Support\Facades\Process;
use Throwable;

/**
 * Signs the `claude` or `codex` CLI in on THIS machine from the Integrations page. their login command opens the browser on the machine that
 * runs the app and finishes by itself once the user approves there, so this only works when the app runs on the user's own computer.
 * ! Fixed argv only (nothing from the request reaches a command); the CLI's output is never read, stored or logged.
 */
final class CliLogin
{
    // * Only CLIs whose login and status commands are verified. Gemini has none (its login is an interactive prompt), so it keeps the token field.
    private const COMMANDS = [
        'anthropic' => ['login' => ['claude', 'auth', 'login', '--claudeai'], 'status' => ['claude', 'auth', 'status', '--json']],
        'openai' => ['login' => ['codex', 'login'], 'status' => ['codex', 'login', 'status']],
    ];

    public const VENDORS = ['anthropic', 'openai'];

    /** Starts the login in the background (it outlives this request) and returns at once. */
    public function start(string $vendor): bool
    {
        if (! isset(self::COMMANDS[$vendor])) {
            return false;
        }

        [$command, $env] = CliRuntime::resolve(self::COMMANDS[$vendor]['login']);

        try {
            // * A login still waiting from an earlier click would keep its own callback port open: stop it first.
            Process::run(['pkill', '-f', implode(' ', self::COMMANDS[$vendor]['login'])]);
            // * Detached with nohup: a child of the web request would be stopped when the request ends.
            Process::env($env)->run(['sh', '-c', 'nohup "$0" "$@" >/dev/null 2>&1 &', ...$command]);
        } catch (Throwable) {
            return false;
        }

        return true;
    }

    public function loggedIn(string $vendor): bool
    {
        if (! isset(self::COMMANDS[$vendor])) {
            return false;
        }

        [$command, $env] = CliRuntime::resolve(self::COMMANDS[$vendor]['status']);

        try {
            $result = Process::env($env)->timeout(15)->run($command);
        } catch (Throwable) {
            return false;
        }

        if ($vendor === 'anthropic') {
            $data = json_decode($result->output(), true);

            return is_array($data) && ($data['loggedIn'] ?? false) === true;
        }

        return $result->successful() && preg_match('/not logged in/i', $result->output().$result->errorOutput()) !== 1
            && preg_match('/logged in/i', $result->output().$result->errorOutput()) === 1;
    }
}
