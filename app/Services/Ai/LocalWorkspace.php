<?php

declare(strict_types=1);

namespace App\Services\Ai;

use Illuminate\Http\Request;

/**
 * Read and (after the person's approval) write text files inside a few configured folders of this machine.
 * ! Every client path is relative to a root picked by id, normalised, checked against a deny list, resolved with realpath and
 * ! required to stay inside the realpath of the root (symlinks cannot escape, also for new files: the parent folder is checked).
 * ! Errors carry fixed messages only, never a server path.
 */
class LocalWorkspace
{
    public const MAX_READ_BYTES = 1_000_000;

    public const MAX_WRITE_BYTES = 100_000;

    public const MAX_TREE_ENTRIES = 2000;

    public const MAX_DEPTH = 12;

    private const DENIED_DIRECTORIES = ['.git', 'storage', 'vendor', 'node_modules'];

    /** Shell-style patterns matched against the lower-cased file name. */
    private const DENIED_NAMES = ['.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*.keystore', 'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*', 'credentials*', 'secret*', '*.secret', '.npmrc', '.htpasswd', '.netrc', 'auth.json'];

    /** * Why local access is refused for this request, or null when it is allowed. */
    public function refusal(Request $request): ?string
    {
        if (! (bool) config('ai-chat.local_workspace.enabled')) {
            return LocalWorkspaceException::DISABLED;
        }

        if (app()->isProduction()) {
            return LocalWorkspaceException::PRODUCTION;
        }

        // * REMOTE_ADDR itself, not a forwarded header a client could set.
        return in_array($request->server('REMOTE_ADDR'), ['127.0.0.1', '::1'], true) ? null : LocalWorkspaceException::NOT_LOOPBACK;
    }

    /** @return list<array{id: string}> only ids: the folders' paths stay on the server */
    public function roots(): array
    {
        return array_map(fn (string $id): array => ['id' => $id], array_keys($this->configuredRoots()));
    }

    /** @return array<string, string> */
    private function configuredRoots(): array
    {
        return array_filter((array) config('ai-chat.local_workspace.roots', []), fn (mixed $path, mixed $id): bool => is_string($path) && is_string($id) && realpath($path) !== false && is_dir($path), ARRAY_FILTER_USE_BOTH);
    }

    /** @throws LocalWorkspaceException */
    private function rootPath(string $rootId): string
    {
        $path = $this->configuredRoots()[$rootId] ?? throw new LocalWorkspaceException(LocalWorkspaceException::UNKNOWN_ROOT, 404);

        return rtrim((string) realpath($path), DIRECTORY_SEPARATOR);
    }

    /** * A clean relative path ("a/b.txt"), or null for anything that could climb out or hide something. */
    public function normalise(string $path): ?string
    {
        if ($path === '' || strlen($path) > 300 || preg_match('/[\x00-\x1f\x7f\\\\]/', $path) === 1 || str_starts_with($path, '/') || preg_match('#^[A-Za-z]:#', $path) === 1) {
            return null;
        }

        $segments = [];

        foreach (explode('/', $path) as $segment) {
            if ($segment === '..' || $segment === '' || $segment === '.') {
                return null;
            }

            $segments[] = $segment;
        }

        return implode('/', $segments);
    }

    /** * Paths the AI and the person may never read or write: secrets, keys, repo internals, dependencies. */
    public function denied(string $relative): bool
    {
        $segments = explode('/', strtolower($relative));
        $name = array_pop($segments);

        foreach ($segments as $segment) {
            if (in_array($segment, self::DENIED_DIRECTORIES, true)) {
                return true;
            }
        }

        if (in_array($name, self::DENIED_DIRECTORIES, true)) {
            return true;
        }

        foreach (self::DENIED_NAMES as $pattern) {
            if (fnmatch($pattern, $name)) {
                return true;
            }
        }

        return false;
    }

    /**
     * File paths under a root (no symlinks followed, denied folders skipped), capped in count and depth.
     *
     * @return array{paths: list<string>, truncated: bool}
     *
     * @throws LocalWorkspaceException
     */
    public function tree(string $rootId): array
    {
        $root = $this->rootPath($rootId);
        $paths = [];
        $truncated = false;
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveCallbackFilterIterator(
                new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
                function (\SplFileInfo $entry) use ($root): bool {
                    if ($entry->isLink()) {
                        return false;
                    }

                    return ! $this->denied(ltrim(substr($entry->getPathname(), strlen($root)), DIRECTORY_SEPARATOR));
                },
            ),
            \RecursiveIteratorIterator::SELF_FIRST,
            \RecursiveIteratorIterator::CATCH_GET_CHILD,
        );
        $iterator->setMaxDepth(self::MAX_DEPTH);

        foreach ($iterator as $entry) {
            if (! $entry->isFile()) {
                continue;
            }

            if (count($paths) >= self::MAX_TREE_ENTRIES) {
                $truncated = true;

                break;
            }

            $paths[] = str_replace(DIRECTORY_SEPARATOR, '/', ltrim(substr($entry->getPathname(), strlen($root)), DIRECTORY_SEPARATOR));
        }

        sort($paths);

        return ['paths' => $paths, 'truncated' => $truncated];
    }

    /**
     * Text of one allowed file. Refuses denied names, links leaving the root, binary data and files over the size limit.
     *
     * @throws LocalWorkspaceException
     */
    public function read(string $rootId, string $path): string
    {
        $full = $this->existingFile($rootId, $path);
        $size = filesize($full);

        if ($size === false || $size > self::MAX_READ_BYTES) {
            throw new LocalWorkspaceException(LocalWorkspaceException::TOO_LARGE);
        }

        $content = file_get_contents($full);

        if ($content === false || str_contains($content, "\0") || ! mb_check_encoding($content, 'UTF-8')) {
            throw new LocalWorkspaceException(LocalWorkspaceException::NOT_TEXT);
        }

        return $content;
    }

    /** * Hash of the file's current content, or null when it does not exist (a new file). */
    public function currentHash(string $rootId, string $path): ?string
    {
        $relative = $this->allowedRelative($path);
        $parent = $this->parentDirectory($rootId, $relative);
        $full = $parent.DIRECTORY_SEPARATOR.basename($relative);

        if (! file_exists($full) && ! is_link($full)) {
            return null;
        }

        return self::hash($this->read($rootId, $path));
    }

    public static function hash(string $content): string
    {
        return hash('sha256', $content);
    }

    /**
     * Atomic write of an approved edit: temp file in the same folder, then rename, keeping the file's permissions.
     * `$expectedHash` is the hash seen when the edit was proposed (null = the file did not exist); a different current state is a conflict.
     *
     * @return array{before: string|null, after: string}
     *
     * @throws LocalWorkspaceException
     */
    public function write(string $rootId, string $path, string $content, ?string $expectedHash): array
    {
        if (strlen($content) > self::MAX_WRITE_BYTES) {
            throw new LocalWorkspaceException(LocalWorkspaceException::TOO_LARGE);
        }

        $relative = $this->allowedRelative($path);
        $parent = $this->parentDirectory($rootId, $relative);
        $full = $parent.DIRECTORY_SEPARATOR.basename($relative);

        // * A link as the target could point anywhere, even when its folder is inside the root.
        if (is_link($full)) {
            throw new LocalWorkspaceException(LocalWorkspaceException::BAD_PATH);
        }

        $current = $this->currentHash($rootId, $path);

        if ($current !== $expectedHash) {
            throw new LocalWorkspaceException(LocalWorkspaceException::CONFLICT, 409);
        }

        $mode = file_exists($full) ? (fileperms($full) & 0777) : 0644;
        $temporary = tempnam($parent, '.ai-write-');

        if ($temporary === false) {
            throw new LocalWorkspaceException(LocalWorkspaceException::WRITE_FAILED, 500);
        }

        if (file_put_contents($temporary, $content) === false || ! chmod($temporary, $mode) || ! rename($temporary, $full)) {
            @unlink($temporary);

            throw new LocalWorkspaceException(LocalWorkspaceException::WRITE_FAILED, 500);
        }

        return ['before' => $current, 'after' => self::hash($content)];
    }

    /**
     * Prompt section for the AI: file list plus the files the person named. Content is untrusted data, each file in its own `<file_data>` block.
     *
     * @throws LocalWorkspaceException
     */
    public function context(string $rootId, string $message): string
    {
        ['paths' => $paths] = $this->tree($rootId);
        $sections = ["Thư mục local: {$rootId}\nCác tệp (tối đa 300):\n".implode("\n", array_slice($paths, 0, 300))];
        $named = 0;

        foreach ($paths as $path) {
            if ($named >= 4) {
                break;
            }

            if (! str_contains($message, $path) && ! str_contains($message, basename($path))) {
                continue;
            }

            try {
                $content = $this->read($rootId, $path);
            } catch (LocalWorkspaceException) {
                continue;
            }

            // * Same tag cleaning as every other data block: the file cannot close its own block.
            $clean = preg_replace('/<\/?\s*[a-z_]*_data\b[^>]*>/iu', '', mb_substr($content, 0, 8000)) ?? '';
            $sections[] = "<file_data path=\"{$path}\">\n{$clean}\n</file_data>";
            $named++;
        }

        return implode("\n\n", $sections);
    }

    /** @throws LocalWorkspaceException */
    private function allowedRelative(string $path): string
    {
        $relative = $this->normalise($path) ?? throw new LocalWorkspaceException(LocalWorkspaceException::BAD_PATH);

        if ($this->denied($relative)) {
            throw new LocalWorkspaceException(LocalWorkspaceException::DENIED, 403);
        }

        return $relative;
    }

    /** * Realpath of an existing regular file inside the root (re-checked against the deny list after links are resolved). */
    private function existingFile(string $rootId, string $path): string
    {
        $relative = $this->allowedRelative($path);
        $root = $this->rootPath($rootId);
        $full = realpath($root.DIRECTORY_SEPARATOR.$relative);

        if ($full === false || ! is_file($full)) {
            throw new LocalWorkspaceException(LocalWorkspaceException::NOT_FOUND, 404);
        }

        $this->assertInside($root, $full);

        if ($this->denied(ltrim(str_replace(DIRECTORY_SEPARATOR, '/', substr($full, strlen($root))), '/'))) {
            throw new LocalWorkspaceException(LocalWorkspaceException::DENIED, 403);
        }

        return $full;
    }

    /** * Realpath of the folder that holds (or will hold) the file; it must exist and sit inside the root. */
    private function parentDirectory(string $rootId, string $relative): string
    {
        $root = $this->rootPath($rootId);
        $parent = realpath($root.DIRECTORY_SEPARATOR.dirname($relative));

        if ($parent === false || ! is_dir($parent)) {
            throw new LocalWorkspaceException(LocalWorkspaceException::NOT_FOUND, 404);
        }

        $this->assertInside($root, $parent);

        // * A folder reached through a link may resolve into a denied one (e.g. `docs` -> `.git`).
        if ($this->denied(ltrim(str_replace(DIRECTORY_SEPARATOR, '/', substr($parent, strlen($root))), '/').'/x')) {
            throw new LocalWorkspaceException(LocalWorkspaceException::DENIED, 403);
        }

        return $parent;
    }

    private function assertInside(string $root, string $resolved): void
    {
        if ($resolved !== $root && ! str_starts_with($resolved, $root.DIRECTORY_SEPARATOR)) {
            throw new LocalWorkspaceException(LocalWorkspaceException::BAD_PATH);
        }
    }
}
