<?php

declare(strict_types=1);

namespace App\Services\Ai;

/** * Pulls the `<<<FILE:path>>> ... <<<END>>>` blocks out of an AI answer and leaves a short marker where each one was. */
final class EditProposalExtractor
{
    private const PATTERN = '/^<<<FILE:([^\n>]+)>>>\R(.*?)\R?^<<<END>>>[ \t]*$/ms';

    /** @return array{text: string, files: list<array{path: string, content: string}>} */
    public function extract(string $answer): array
    {
        $files = [];

        $text = preg_replace_callback(self::PATTERN, function (array $match) use (&$files): string {
            $path = trim($match[1]);
            $files[] = ['path' => $path, 'content' => $match[2]];

            return "📝 Đề xuất sửa: {$path}";
        }, $answer);

        return ['text' => trim($text ?? $answer), 'files' => $files];
    }
}
