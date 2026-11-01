<?php

declare(strict_types=1);

namespace App\Notifications\Concerns;

trait RendersTemplate
{
    /** @param array<string, string> $values */
    private function render(string $line, array $values): string
    {
        $pairs = [];

        foreach ($values as $key => $value) {
            $pairs[":{$key}"] = $value;
        }

        return strtr($line, $pairs);
    }
}
