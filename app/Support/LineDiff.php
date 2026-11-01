<?php

declare(strict_types=1);

namespace App\Support;

/** * Small line diff (longest common subsequence) shown to the person before they approve an AI edit. Not a patch format: only for reading. */
final class LineDiff
{
    private const MAX_LINES = 1500;

    private const CONTEXT = 3;

    public static function unified(string $old, string $new): string
    {
        $a = $old === '' ? [] : explode("\n", str_replace("\r\n", "\n", $old));
        $b = $new === '' ? [] : explode("\n", str_replace("\r\n", "\n", $new));

        if (count($a) > self::MAX_LINES || count($b) > self::MAX_LINES) {
            return '(File quá lớn để hiển thị diff: '.count($a).' → '.count($b).' dòng.)';
        }

        $ops = self::ops($a, $b);
        $changed = [];

        foreach ($ops as $index => [$kind]) {
            if ($kind !== ' ') {
                $changed[] = $index;
            }
        }

        if ($changed === []) {
            return '(Không có thay đổi.)';
        }

        // * Keep the changed lines and CONTEXT lines around them; a gap between kept ranges becomes "…".
        $keep = [];

        foreach ($changed as $index) {
            for ($i = max(0, $index - self::CONTEXT); $i <= min(count($ops) - 1, $index + self::CONTEXT); $i++) {
                $keep[$i] = true;
            }
        }

        $lines = [];
        $last = -1;

        foreach (array_keys($keep) as $i) {
            if ($last !== -1 && $i > $last + 1) {
                $lines[] = '…';
            }

            $lines[] = $ops[$i][0].' '.$ops[$i][1];
            $last = $i;
        }

        return implode("\n", $lines);
    }

    /**
     * The text before an edit: `$current` is the file after it and `$diff` the stored change. Each changed block is found again by its new lines and swapped for its old ones; null when a block no longer matches (the file changed since) or the diff is not a line diff.
     */
    public static function restore(string $current, string $diff): ?string
    {
        $groups = [[]];

        foreach (explode("\n", $diff) as $line) {
            if ($line === '…') {
                $groups[] = [];

                continue;
            }

            if (preg_match('/^[ +-] /', $line) !== 1) {
                return null;
            }

            $groups[array_key_last($groups)][] = $line;
        }

        $file = explode("\n", str_replace("\r\n", "\n", $current));
        $original = [];
        $cursor = 0;

        foreach (array_filter($groups) as $rows) {
            $after = [];
            $before = [];

            foreach ($rows as $row) {
                $text = substr($row, 2);

                if ($row[0] !== '-') {
                    $after[] = $text;
                }

                if ($row[0] !== '+') {
                    $before[] = $text;
                }
            }

            $at = self::find($file, $after, $cursor);

            if ($at === null) {
                return null;
            }

            array_push($original, ...array_slice($file, $cursor, $at - $cursor), ...$before);
            $cursor = $at + count($after);
        }

        array_push($original, ...array_slice($file, $cursor));

        return implode("\n", $original);
    }

    /**
     * @param  list<string>  $lines
     * @param  list<string>  $needle
     */
    private static function find(array $lines, array $needle, int $from): ?int
    {
        for ($start = $from; $start <= count($lines) - count($needle); $start++) {
            if (array_slice($lines, $start, count($needle)) === $needle) {
                return $start;
            }
        }

        return null;
    }

    /**
     * @param  list<string>  $a
     * @param  list<string>  $b
     * @return list<array{0: string, 1: string}> [' '|'+'|'-', line]
     */
    private static function ops(array $a, array $b): array
    {
        $n = count($a);
        $m = count($b);
        $table = array_fill(0, $n + 1, array_fill(0, $m + 1, 0));

        for ($i = $n - 1; $i >= 0; $i--) {
            for ($j = $m - 1; $j >= 0; $j--) {
                $table[$i][$j] = $a[$i] === $b[$j] ? $table[$i + 1][$j + 1] + 1 : max($table[$i + 1][$j], $table[$i][$j + 1]);
            }
        }

        $ops = [];
        $i = 0;
        $j = 0;

        while ($i < $n && $j < $m) {
            if ($a[$i] === $b[$j]) {
                $ops[] = [' ', $a[$i]];
                $i++;
                $j++;
            } elseif ($table[$i + 1][$j] >= $table[$i][$j + 1]) {
                $ops[] = ['-', $a[$i++]];
            } else {
                $ops[] = ['+', $b[$j++]];
            }
        }

        while ($i < $n) {
            $ops[] = ['-', $a[$i++]];
        }

        while ($j < $m) {
            $ops[] = ['+', $b[$j++]];
        }

        return $ops;
    }
}
