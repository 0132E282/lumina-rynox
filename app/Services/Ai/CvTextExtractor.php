<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Process;
use Throwable;
use ZipArchive;

/**
 * Plain text of an uploaded CV (pdf, docx, txt, md) for the AI to read. Nothing is stored: the temp upload is read once and dropped.
 * ! The file's type comes from its extension and is then proven by reading it (pdftotext or a zip with word/document.xml); the path is never put in a shell string.
 */
final class CvTextExtractor
{
    public const EXTENSIONS = ['pdf', 'docx', 'txt', 'md'];

    private const MAX_CHARS = 20000;

    /** @return string|null null when the file cannot be read as text */
    public function extract(UploadedFile $file): ?string
    {
        $path = (string) $file->getRealPath();
        $text = match (strtolower($file->getClientOriginalExtension())) {
            'pdf' => $this->pdf($path),
            'docx' => $this->docx($path),
            'txt', 'md' => (string) @file_get_contents($path),
            default => null,
        };

        if ($text === null) {
            return null;
        }

        $text = trim((string) preg_replace("/[ \t]+/u", ' ', (string) preg_replace("/\r\n?|\n{3,}/u", "\n\n", $text)));

        return $text === '' || ! mb_check_encoding($text, 'UTF-8') ? null : mb_substr($text, 0, self::MAX_CHARS);
    }

    private function pdf(string $path): ?string
    {
        // * The web process can have a short PATH without Homebrew: look for the binary in the usual folders too.
        [$command, $env] = CliRuntime::resolve(['pdftotext', '-enc', 'UTF-8', '-layout', $path, '-']);

        try {
            $result = Process::env($env)->timeout(20)->run($command);
        } catch (Throwable) {
            return null;
        }

        return $result->successful() ? $result->output() : null;
    }

    private function docx(string $path): ?string
    {
        $zip = new ZipArchive;

        if ($zip->open($path) !== true) {
            return null;
        }

        $xml = $zip->getFromName('word/document.xml');
        $zip->close();

        if ($xml === false) {
            return null;
        }

        // * Paragraph ends become line breaks; every other tag is dropped.
        return html_entity_decode(strip_tags((string) preg_replace('#</w:p>#', "\n", $xml)), ENT_QUOTES | ENT_XML1, 'UTF-8');
    }
}
