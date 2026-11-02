<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;

/**
 * Images attached to one chat message, for the CLI that answers it. Each upload is copied under a fresh random name (the extension comes from the
 * detected image type, never from the person's file name) into the CLI's own empty working folder and deleted when the request ends.
 * ! Scoped to the request: the paths never outlive it and never reach a log, the thread or the database.
 */
final class ChatImages
{
    public const EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

    private const TYPES = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp'];

    /** @var list<string> */
    private array $paths = [];

    /** True only for a real image of an allowed type (the content is checked, not just the name). */
    public static function isImage(UploadedFile $file): bool
    {
        return in_array(strtolower($file->getClientOriginalExtension()), self::EXTENSIONS, true)
            && isset(self::TYPES[(int) (@getimagesize((string) $file->getRealPath())[2] ?? 0)]);
    }

    /** Copies the upload next to the CLI's working directory and remembers it until `clear()` (also run when the request ends). */
    public function store(UploadedFile $file): string
    {
        $extension = self::TYPES[(int) (@getimagesize((string) $file->getRealPath())[2] ?? 0)];
        $directory = storage_path('app/ai-cli/images');
        File::ensureDirectoryExists($directory);

        $path = $directory.'/'.Str::uuid().'.'.$extension;
        File::copy((string) $file->getRealPath(), $path);

        if ($this->paths === []) {
            app()->terminating(fn () => $this->clear());
        }

        return $this->paths[] = $path;
    }

    /** @return list<string> */
    public function paths(): array
    {
        return $this->paths;
    }

    public function clear(): void
    {
        foreach ($this->paths as $path) {
            @unlink($path);
        }

        $this->paths = [];
    }
}
