<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Symfony\Component\Process\ExecutableFinder;

/**
 * How to start a vendor CLI (`claude`, `codex`, `gemini`) from the web process: where the binary is and which environment it needs.
 */
final class CliRuntime
{
    /**
     * The web process can have a short PATH (server started from an app or a service) that lacks the CLI. When the CLI is not on it,
     * the usual install folders are searched and the full path is used, with PATH extended so the CLI finds its own runtime (node).
     * The CLI also finds its saved login through the user's home folder (and, on macOS, that user's Keychain), so the identity variables
     * a service may not pass on are filled in from the account PHP runs as.
     *
     * @param  list<string>  $command
     * @return array{0: list<string>, 1: array<string, string>} the command and the environment to add for the child
     */
    public static function resolve(array $command): array
    {
        $env = self::identityEnv();
        $finder = new ExecutableFinder;

        if ($finder->find($command[0]) !== null) {
            return [$command, $env];
        }

        $home = self::home();
        $extra = array_filter([
            ...explode(':', (string) config('services.ai_cli.paths', '')),
            '/opt/homebrew/bin',
            '/usr/local/bin',
            $home === '' ? '' : $home.'/.local/bin',
            $home === '' ? '' : $home.'/.claude/local',
            ...($home === '' ? [] : (glob($home.'/.nvm/versions/node/*/bin') ?: [])),
        ]);
        $found = $finder->find($command[0], null, $extra);

        if ($found === null) {
            return [$command, $env];
        }

        $command[0] = $found;
        $env['PATH'] = implode(':', array_unique([dirname($found), ...$extra, (string) getenv('PATH')]));

        return [$command, $env];
    }

    /** * Home folder of the user running PHP: `HOME` when set, else from the system account (a dev server or FPM often starts without `HOME`). */
    public static function home(): string
    {
        $home = (string) getenv('HOME');

        if ($home !== '') {
            return $home;
        }

        $user = function_exists('posix_getpwuid') ? posix_getpwuid(posix_geteuid()) : false;

        return is_array($user) ? (string) $user['dir'] : '';
    }

    /** @return array<string, string> */
    private static function identityEnv(): array
    {
        $user = function_exists('posix_getpwuid') ? (posix_getpwuid(posix_geteuid()) ?: null) : null;
        $env = [];

        foreach (['HOME' => $user['dir'] ?? null, 'USER' => $user['name'] ?? null, 'LOGNAME' => $user['name'] ?? null] as $name => $value) {
            if (is_string($value) && $value !== '' && ! filled(getenv($name))) {
                $env[$name] = $value;
            }
        }

        return $env;
    }
}
