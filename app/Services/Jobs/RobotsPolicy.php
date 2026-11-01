<?php

declare(strict_types=1);

namespace App\Services\Jobs;

/**
 * Minimal robots.txt reader for `User-agent: *` groups (longest matching rule wins, Allow beats Disallow on a tie,
 * `*` and `$` supported). An unreadable robots.txt is treated by the caller; this class only parses text.
 */
final class RobotsPolicy
{
    /** @var list<array{allow: bool, pattern: string}> */
    private array $rules = [];

    public function __construct(string $robotsTxt)
    {
        $appliesToAll = false;
        $previousWasAgent = false;

        foreach (preg_split('/\R/', $robotsTxt) ?: [] as $line) {
            $line = trim((string) preg_replace('/#.*$/', '', $line));

            if (! str_contains($line, ':')) {
                continue;
            }

            [$field, $value] = array_map('trim', explode(':', $line, 2));
            $field = strtolower($field);

            if ($field === 'user-agent') {
                // * Consecutive User-agent lines form one group; a new group after rules resets the match.
                $appliesToAll = ($previousWasAgent && $appliesToAll) || $value === '*';
                $previousWasAgent = true;

                continue;
            }

            $previousWasAgent = false;

            if ($appliesToAll && in_array($field, ['allow', 'disallow'], true) && $value !== '') {
                $this->rules[] = ['allow' => $field === 'allow', 'pattern' => $value];
            }
        }
    }

    public function allows(string $pathAndQuery): bool
    {
        $best = null;

        foreach ($this->rules as $rule) {
            if (! $this->matches($rule['pattern'], $pathAndQuery)) {
                continue;
            }

            if ($best === null || strlen($rule['pattern']) > strlen($best['pattern']) || (strlen($rule['pattern']) === strlen($best['pattern']) && $rule['allow'])) {
                $best = $rule;
            }
        }

        return $best === null || $best['allow'];
    }

    private function matches(string $pattern, string $path): bool
    {
        $regex = '/^'.str_replace(['\*', '\$'], ['.*', '$'], preg_quote($pattern, '/')).'/';

        return preg_match($regex, $path) === 1;
    }
}
