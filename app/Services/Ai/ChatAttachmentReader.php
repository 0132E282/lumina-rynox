<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\UploadedFile;

/** * Plain text of a file attached in the AI chat. Nothing is stored: the temp upload is read once and dropped. */
final class ChatAttachmentReader
{
    /** Text and code files read as they are; pdf/docx/txt/md go through the CV extractor. */
    public const CODE_EXTENSIONS = ['php', 'js', 'jsx', 'ts', 'tsx', 'vue', 'json', 'csv', 'yml', 'yaml', 'toml', 'ini', 'css', 'scss', 'html', 'sql', 'sh', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'xml', 'log'];

    private const MAX_CHARS = 20000;

    public function __construct(private readonly CvTextExtractor $extractor) {}

    /** @return list<string> */
    public static function extensions(): array
    {
        return [...CvTextExtractor::EXTENSIONS, ...self::CODE_EXTENSIONS];
    }

    /** @return string|null null when the file cannot be read as text */
    public function read(UploadedFile $file): ?string
    {
        $extension = strtolower($file->getClientOriginalExtension());

        if (in_array($extension, CvTextExtractor::EXTENSIONS, true)) {
            return $this->extractor->extract($file);
        }

        if (! in_array($extension, self::CODE_EXTENSIONS, true)) {
            return null;
        }

        $text = (string) @file_get_contents((string) $file->getRealPath());

        return $text === '' || ! mb_check_encoding($text, 'UTF-8') ? null : mb_substr($text, 0, self::MAX_CHARS);
    }
}
