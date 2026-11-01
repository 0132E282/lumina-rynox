<?php

declare(strict_types=1);

namespace App\Support;

class AppPasswordGate
{
    private const SESSION_KEY = 'app_password_confirmed_at';

    private const TIMEOUT_SECONDS = 900;

    public static function confirmed(): bool
    {
        $confirmedAt = session(self::SESSION_KEY);

        return $confirmedAt !== null && (now()->timestamp - $confirmedAt) < self::TIMEOUT_SECONDS;
    }

    public static function attempt(string $password): bool
    {
        $configured = config('cms.app_password');

        if (blank($configured) || $password !== $configured) {
            return false;
        }

        session([self::SESSION_KEY => now()->timestamp]);

        return true;
    }
}
