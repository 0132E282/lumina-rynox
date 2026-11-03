<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Support\Facades\Cache;

/**
 * Who a vendor CLI is logged in as on this machine (an email, for the usage dialog): so two logins of one vendor can be told apart.
 * ! Only the email is read out of the CLI's own login file; tokens in those files are never returned, logged or cached.
 */
final class CliIdentity
{
    private const CACHE_SECONDS = 300;

    public function of(string $vendor): ?string
    {
        return Cache::remember("ai-cli-identity.{$vendor}", self::CACHE_SECONDS, fn (): ?string => $this->read($vendor)) ?: null;
    }

    private function read(string $vendor): ?string
    {
        $home = $this->home();

        if ($home === null) {
            return null;
        }

        $email = match ($vendor) {
            'anthropic' => $this->json("{$home}/.claude.json")['oauthAccount']['emailAddress'] ?? null,
            'openai' => $this->fromIdToken($this->json("{$home}/.codex/auth.json")['tokens']['id_token'] ?? null),
            default => null,
        };

        return is_string($email) && filter_var($email, FILTER_VALIDATE_EMAIL) !== false ? $email : '';
    }

    /** @return array<string, mixed> */
    private function json(string $path): array
    {
        $text = is_file($path) && ! is_link($path) && filesize($path) < 1_000_000 ? @file_get_contents($path) : false;
        $data = $text === false ? null : json_decode($text, true);

        return is_array($data) ? $data : [];
    }

    /** The email claim of a login token; the token is only decoded here (no network, no verification) and dropped. */
    private function fromIdToken(mixed $token): ?string
    {
        $part = is_string($token) ? (explode('.', $token)[1] ?? null) : null;
        $payload = $part === null ? false : base64_decode(strtr($part, '-_', '+/'), true);
        $claims = $payload === false ? null : json_decode($payload, true);

        return is_array($claims) && is_string($claims['email'] ?? null) ? $claims['email'] : null;
    }

    private function home(): ?string
    {
        $home = getenv('HOME');

        if (! is_string($home) || $home === '') {
            $user = function_exists('posix_getpwuid') ? posix_getpwuid(posix_geteuid()) : false;
            $home = $user === false ? null : $user['dir'];
        }

        return is_string($home) && is_dir($home) ? rtrim($home, '/') : null;
    }
}
