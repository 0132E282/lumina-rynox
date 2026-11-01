<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * Stores the uploaded assistant avatar on the private disk, one random file name per upload under the user's own folder.
 * ! The type comes from the file's real content (never the extension or the client's content type); svg and anything that is not jpg/png/webp/gif is refused.
 * With GD available the image is decoded and re-encoded as a square of at most 256 px (EXIF and anything appended is dropped); without GD the checked file is stored as it is.
 */
final class AssistantAvatarStore
{
    public const DISK = 'local';

    public const MAX_BYTES = 1_048_576;

    public const MAX_SIDE = 2048;

    public const OUTPUT_SIDE = 256;

    /** Same pattern idea as the Messenger avatar: only paths this class could have written are ever served. */
    public const PATH_PATTERN = '#^ai-chat/avatars/\d+/[a-f0-9]{40}\.(webp|png|jpg|gif)$#';

    public const MIMES = ['webp' => 'image/webp', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'gif' => 'image/gif'];

    private const TYPES = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];

    /** @throws RuntimeException with a fixed message when the file is not an acceptable image */
    public function store(int $userId, UploadedFile $file): string
    {
        $real = (string) $file->getRealPath();
        $info = $real === '' || filesize($real) > self::MAX_BYTES ? false : @getimagesize($real);

        if ($info === false || ! isset(self::TYPES[$info[2]]) || $info[0] > self::MAX_SIDE || $info[1] > self::MAX_SIDE || $info[0] < 1 || $info[1] < 1) {
            throw new RuntimeException('Ảnh không hợp lệ (chỉ nhận jpg, png, webp, gif tối đa 1 MB và 2048 px).');
        }

        [$bytes, $extension] = $this->normalised($real, self::TYPES[$info[2]]);
        $path = "ai-chat/avatars/{$userId}/".bin2hex(random_bytes(20)).'.'.$extension;

        Storage::disk(self::DISK)->put($path, $bytes);

        return $path;
    }

    public function delete(?string $path): void
    {
        if ($path !== null && preg_match(self::PATH_PATTERN, $path) === 1) {
            Storage::disk(self::DISK)->delete($path);
        }
    }

    /** @return array{0: string, 1: string} bytes and extension */
    private function normalised(string $real, string $extension): array
    {
        $original = (string) file_get_contents($real);

        if (! extension_loaded('gd')) {
            return [$original, $extension];
        }

        $source = @imagecreatefromstring($original);

        if ($source === false) {
            throw new RuntimeException('Ảnh không hợp lệ (chỉ nhận jpg, png, webp, gif tối đa 1 MB và 2048 px).');
        }

        $width = imagesx($source);
        $height = imagesy($source);
        $side = min($width, $height);
        $target = imagecreatetruecolor(min($side, self::OUTPUT_SIDE), min($side, self::OUTPUT_SIDE));
        imagealphablending($target, false);
        imagesavealpha($target, true);
        imagefill($target, 0, 0, (int) imagecolorallocatealpha($target, 0, 0, 0, 127));
        imagecopyresampled($target, $source, 0, 0, intdiv($width - $side, 2), intdiv($height - $side, 2), imagesx($target), imagesy($target), $side, $side);

        ob_start();
        $webp = function_exists('imagewebp');
        $webp ? imagewebp($target, null, 85) : imagepng($target);
        $bytes = (string) ob_get_clean();

        return [$bytes, $webp ? 'webp' : 'png'];
    }
}
