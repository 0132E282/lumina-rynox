<?php

declare(strict_types=1);

namespace App\Services\Mail\Imap;

/**
 * Reads an IMAP BODYSTRUCTURE (RFC 3501 s-expression) from a raw FETCH response and lists its leaf parts with their IMAP part
 * paths. Needed because the webklex line decoder mis-splits quoted strings that are directly followed by `)`.
 *
 * @phpstan-type Leaf array{path: string, type: string, subtype: string, encoding: string, charset: string|null, size: int, disposition: string|null, filename: string|null, hasContentId: bool}
 */
final class BodyStructureParser
{
    /**
     * @return list<Leaf>
     */
    public static function leaves(string $rawFetchResponse): array
    {
        $start = stripos($rawFetchResponse, 'BODYSTRUCTURE');

        if ($start === false) {
            return [];
        }

        $position = $start + strlen('BODYSTRUCTURE');
        $node = self::readValue($rawFetchResponse, $position);

        if (! is_array($node)) {
            return [];
        }

        $leaves = [];
        self::collect($node, '', true, $leaves);

        return $leaves;
    }

    /**
     * @param  array<int|string, mixed>  $node
     * @param  list<Leaf>  $leaves
     */
    private static function collect(array $node, string $path, bool $isTop, array &$leaves): void
    {
        if (isset($node[0]) && is_array($node[0])) {
            $index = 0;

            foreach ($node as $child) {
                if (! is_array($child)) {
                    break;
                }

                $index++;
                self::collect($child, $isTop ? (string) $index : "{$path}.{$index}", false, $leaves);
            }

            return;
        }

        $params = self::params($node[2] ?? null);
        $disposition = null;
        $dispositionParams = [];

        foreach (array_slice($node, 7) as $field) {
            if (is_array($field) && isset($field[0]) && is_string($field[0]) && in_array(strtolower($field[0]), ['attachment', 'inline'], true)) {
                $disposition = strtolower($field[0]);
                $dispositionParams = self::params($field[1] ?? null);

                break;
            }
        }

        $filename = $dispositionParams['filename*'] ?? $dispositionParams['filename'] ?? $params['name*'] ?? $params['name'] ?? null;

        $leaves[] = [
            'path' => $isTop ? '1' : $path,
            'type' => strtolower((string) ($node[0] ?? 'text')),
            'subtype' => strtolower((string) ($node[1] ?? 'plain')),
            'encoding' => strtolower((string) ($node[5] ?? '7bit')),
            'charset' => isset($params['charset']) ? strtolower($params['charset']) : null,
            'size' => (int) ($node[6] ?? 0),
            'disposition' => $disposition,
            'filename' => $filename === null ? null : self::decodeFilename($filename),
            'hasContentId' => isset($node[3]) && $node[3] !== '',
        ];
    }

    /**
     * @return array<string, string>
     */
    private static function params(mixed $list): array
    {
        $params = [];

        if (! is_array($list)) {
            return $params;
        }

        for ($index = 0; $index + 1 < count($list); $index += 2) {
            if (is_string($list[$index]) && is_string($list[$index + 1])) {
                $params[strtolower($list[$index])] = $list[$index + 1];
            }
        }

        return $params;
    }

    /** * RFC 2231 (`utf-8''%E2%82%AC.pdf`) and RFC 2047 (`=?UTF-8?B?...?=`) names to UTF-8; control characters removed, 255 chars max. */
    private static function decodeFilename(string $raw): string
    {
        if (preg_match("/^([\\w-]+)'[^']*'(.*)$/", $raw, $matches) === 1) {
            $raw = PartDecoder::toUtf8(rawurldecode($matches[2]), $matches[1]);
        } elseif (str_contains($raw, '=?')) {
            $decoded = mb_decode_mimeheader($raw);
            $raw = $decoded;
        }

        $clean = preg_replace('/[\x00-\x1F\x7F]+/u', '', mb_scrub($raw)) ?? '';

        return mb_substr(trim($clean), 0, 255);
    }

    /**
     * @return array<int|string, mixed>|string|null null for NIL
     */
    private static function readValue(string $input, int &$position): array|string|null
    {
        $length = strlen($input);

        while ($position < $length && ctype_space($input[$position])) {
            $position++;
        }

        if ($position >= $length) {
            return null;
        }

        $char = $input[$position];

        if ($char === '(') {
            $position++;
            $list = [];

            while (true) {
                while ($position < $length && ctype_space($input[$position])) {
                    $position++;
                }

                if ($position >= $length) {
                    return $list;
                }

                if ($input[$position] === ')') {
                    $position++;

                    return $list;
                }

                $list[] = self::readValue($input, $position);
            }
        }

        if ($char === '"') {
            $position++;
            $value = '';

            while ($position < $length && $input[$position] !== '"') {
                if ($input[$position] === '\\' && $position + 1 < $length) {
                    $position++;
                }

                $value .= $input[$position];
                $position++;
            }

            $position++;

            return $value;
        }

        if ($char === '{' && preg_match('/\G\{(\d+)\}\r?\n/', $input, $matches, 0, $position) === 1) {
            $position += strlen($matches[0]);
            $value = substr($input, $position, (int) $matches[1]);
            $position += (int) $matches[1];

            return $value;
        }

        $start = $position;

        while ($position < $length && ! ctype_space($input[$position]) && $input[$position] !== '(' && $input[$position] !== ')') {
            $position++;
        }

        $atom = substr($input, $start, $position - $start);

        return strcasecmp($atom, 'NIL') === 0 ? null : $atom;
    }
}
