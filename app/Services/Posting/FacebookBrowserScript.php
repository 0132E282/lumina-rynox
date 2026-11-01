<?php

declare(strict_types=1);

namespace App\Services\Posting;

use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Support\Facades\Process;
use JsonException;
use Throwable;

/**
 * Runs scripts/facebook-post.mjs (Playwright + the user's real Chrome) on this machine.
 * ! Only the script's fixed JSON/exit code is read: its output is never stored or logged, and no cookie or profile data goes through PHP.
 */
final class FacebookBrowserScript
{
    public const SCRIPT = 'scripts/facebook-post.mjs';

    /** Exit code of a shell that could not find the node binary. */
    private const EXIT_COMMAND_NOT_FOUND = 127;

    /**
     * @param  array<string, mixed>|null  $input  sent as JSON on STDIN
     * @return array{status: 'ok'|'error'|'timed_out'|'no_node'|'no_result', payload: array<string, mixed>}
     */
    public function run(string $mode, ?array $input = null): array
    {
        $command = [(string) config('posting.facebook_personal.node_binary', 'node'), self::SCRIPT, $mode];

        // ! A web request (`dispatchAfterResponse`) is cut at PHP's max_execution_time (30s by default) while Chrome is still posting,
        // ! which loses the result of a post that may already be live. Give this call the script's own timeout plus a margin.
        set_time_limit((int) config('posting.facebook_personal.timeout_seconds', 180) + 60);

        try {
            $result = Process::path(base_path())
                ->env(['FACEBOOK_HEADLESS' => config('posting.facebook_personal.headless') && $mode !== 'login' ? '1' : '0'])
                ->timeout((int) config('posting.facebook_personal.timeout_seconds', 180))
                ->input($input === null ? '' : json_encode($input, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE))
                ->run($command);
        } catch (ProcessTimedOutException) {
            return ['status' => 'timed_out', 'payload' => []];
        } catch (Throwable) {
            // * Typically the node binary or the working directory cannot be started; the message may hold local paths, so it is dropped.
            return ['status' => 'no_node', 'payload' => []];
        }

        if ($result->exitCode() === self::EXIT_COMMAND_NOT_FOUND) {
            return ['status' => 'no_node', 'payload' => []];
        }

        $payload = $this->parse($result->output());

        if ($payload === null) {
            return ['status' => 'no_result', 'payload' => []];
        }

        return ['status' => ($payload['ok'] ?? false) === true ? 'ok' : 'error', 'payload' => $payload];
    }

    /**
     * * Lines are split on `\n` only: `\R` without the `u` flag also matches the byte 0x85, which sits inside many UTF-8 characters and cut the JSON in two.
     *
     * @return array<string, mixed>|null the last JSON object line of the output
     */
    private function parse(string $output): ?array
    {
        foreach (array_reverse(preg_split('/\r?\n/', trim($output)) ?: []) as $line) {
            try {
                $data = json_decode(trim($line), true, 8, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                continue;
            }

            if (is_array($data)) {
                return $data;
            }
        }

        return null;
    }
}
