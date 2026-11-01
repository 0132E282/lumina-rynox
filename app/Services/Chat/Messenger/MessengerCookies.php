<?php

declare(strict_types=1);

namespace App\Services\Chat\Messenger;

use InvalidArgumentException;
use JsonException;

/**
 * Parses a facebook.com cookie string pasted by the user into a `name => value` map. Accepts either the browser
 * header form (`name=value; name=value`) or a JSON object (`{"name": "value"}`). A malformed cookie throws with a
 * fixed message; the offending value never appears in it.
 */
final class MessengerCookies
{
    public const MAX_BYTES = 8192;

    private const NAME_PATTERN = '/^[A-Za-z0-9_.-]+$/';

    private const INVALID_MESSAGE = 'Chuỗi cookie không đúng định dạng.';

    /**
     * @return array<string, string>
     *
     * @throws InvalidArgumentException
     */
    public static function parse(string $raw): array
    {
        if ($raw === '' || strlen($raw) > self::MAX_BYTES) {
            throw new InvalidArgumentException(self::INVALID_MESSAGE);
        }

        $cookies = str_starts_with(ltrim($raw), '{') ? self::parseJson($raw) : self::parseHeader($raw);

        if ($cookies === []) {
            throw new InvalidArgumentException(self::INVALID_MESSAGE);
        }

        return $cookies;
    }

    /** @param array<string, string> $cookies */
    public static function hasRequired(array $cookies, string ...$names): bool
    {
        foreach ($names as $name) {
            if (($cookies[$name] ?? '') === '') {
                return false;
            }
        }

        return true;
    }

    /** @return array<string, string> */
    private static function parseJson(string $raw): array
    {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new InvalidArgumentException(self::INVALID_MESSAGE);
        }

        if (! is_array($decoded)) {
            throw new InvalidArgumentException(self::INVALID_MESSAGE);
        }

        $cookies = [];

        foreach ($decoded as $name => $value) {
            if (! is_string($name) || ! is_string($value)) {
                throw new InvalidArgumentException(self::INVALID_MESSAGE);
            }

            $cookies[$name] = self::validated($name, $value);
        }

        return $cookies;
    }

    /** @return array<string, string> */
    private static function parseHeader(string $raw): array
    {
        $cookies = [];

        foreach (explode(';', $raw) as $pair) {
            $pair = trim($pair);

            if ($pair === '') {
                continue;
            }

            $position = strpos($pair, '=');

            if ($position === false) {
                throw new InvalidArgumentException(self::INVALID_MESSAGE);
            }

            $name = trim(substr($pair, 0, $position));
            $value = trim(substr($pair, $position + 1));
            // * The last occurrence of a repeated name wins, same as a browser's own cookie jar.
            $cookies[$name] = self::validated($name, $value);
        }

        return $cookies;
    }

    private static function validated(string $name, string $value): string
    {
        if (preg_match(self::NAME_PATTERN, $name) !== 1 || preg_match('/[;\r\n]/', $value) === 1) {
            throw new InvalidArgumentException(self::INVALID_MESSAGE);
        }

        return $value;
    }
}
