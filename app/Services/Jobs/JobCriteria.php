<?php

declare(strict_types=1);

namespace App\Services\Jobs;

use Illuminate\Support\Str;

/**
 * Search criteria from the Integration field `criteria`, e.g. `Backend · PHP/Laravel · từ 35 triệu`:
 * segments split on `·`, `|`, `,` or `;`, then `/` splits alternatives. A segment with a number and `triệu`/`tr` is the
 * salary floor (million VND); everything else is a keyword used to build the search URL.
 */
final readonly class JobCriteria
{
    /** @param list<string> $keywords */
    public function __construct(
        public array $keywords,
        public ?int $minSalaryMillion = null,
    ) {}

    public static function parse(?string $text): self
    {
        $keywords = [];
        $minSalary = null;

        foreach (preg_split('/[·|,;]/u', (string) $text) ?: [] as $segment) {
            $segment = trim($segment);

            if ($segment === '') {
                continue;
            }

            if (preg_match('/(\d+)\s*(?:triệu|trieu|tr|m)\b/iu', $segment, $match) === 1) {
                $minSalary = (int) $match[1];

                continue;
            }

            foreach (explode('/', $segment) as $keyword) {
                $keyword = trim($keyword);

                if ($keyword !== '' && ! in_array(Str::lower($keyword), array_map(Str::lower(...), $keywords), true)) {
                    $keywords[] = $keyword;
                }
            }
        }

        return new self($keywords, $minSalary);
    }

    public function isEmpty(): bool
    {
        return $this->keywords === [];
    }
}
