<?php

declare(strict_types=1);

namespace App\Services\Ai;

use App\Models\AiLocalRoot;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;

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

    /** * Most files the changes list shows. */
    private const MAX_CHANGES = 300;

    public const MAX_TREE_ENTRIES = 2000;

    public const MAX_DEPTH = 12;

    public const MAX_PROJECTS = 10;

    public const MAX_FOLDERS_PER_PROJECT = 5;

    /** Folder names (any level) an imported root may not be or sit inside. */
    private const SENSITIVE_FOLDERS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config', '.azure', '.gcloud', '.npm', '.cache', '.local', '.trash', 'library', 'appdata'];

    /** System locations refused even if a base were set too wide. */
    // * Folder search for a browser-picked folder: how deep, how many folders at most, and what is never entered.
    private const FIND_MAX_DEPTH = 7;

    private const FIND_MAX_DIRS = 30000;

    private const FIND_SKIP = ['node_modules', 'vendor', 'library', 'applications', 'pictures', 'music', 'movies'];

    private const SYSTEM_PREFIXES = ['/etc', '/proc', '/sys', '/dev', '/boot', '/root', '/bin', '/sbin', '/usr', '/system'];

    /** @var array<int, array<string, string>> */
    private array $rootCache = [];

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

    /**
     * The roots the signed-in person may use: id and a label only (the folders' paths stay on the server).
     * `folder` is a masked tail ("…/name") for imported folders, null for the folders set up in `.env`.
     *
     * @return list<array{id: string, label: string, imported: bool, folder: string|null}>
     */
    public function roots(): array
    {
        $imported = $this->importedRows()->keyBy('key');
        $rows = [];

        foreach ($this->configuredRoots() as $id => $path) {
            $row = $imported->get($id);
            $rows[] = ['id' => $id, 'label' => $row === null ? $id : $row->project, 'imported' => $row !== null, 'folder' => $row === null ? null : '…/'.basename($path)];
        }

        return $rows;
    }

    /**
     * The person's imported projects with their folders (masked), for the import dialog.
     *
     * @return list<array{key: string, name: string, folders: list<array{id: string, folder: string}>}>
     */
    public function projects(): array
    {
        $usable = $this->configuredRoots();
        $projects = [];

        foreach ($this->importedRows() as $row) {
            if (! isset($usable[$row->key])) {
                continue;
            }

            $projects[$row->project] ??= ['key' => $row->key, 'name' => $row->project, 'folders' => []];
            $projects[$row->project]['folders'][] = ['id' => $row->key, 'folder' => '…/'.basename($usable[$row->key])];
        }

        return array_values($projects);
    }

    /**
     * Adds a project with one to five folders for the signed-in person.
     * ! Every folder: absolute, no `..`/control characters, no link anywhere in the path (it must equal its realpath), an existing directory, inside an allowed base (never the base itself) and outside the sensitive folders.
     *
     * @param  list<string>  $folders
     *
     * @throws LocalWorkspaceException
     */
    public function importProject(string $name, array $folders): void
    {
        $userId = (int) Auth::id();

        if ($folders === [] || count($folders) > self::MAX_FOLDERS_PER_PROJECT) {
            throw new LocalWorkspaceException(LocalWorkspaceException::TOO_MANY_FOLDERS, 422, 'folders');
        }

        $existing = AiLocalRoot::query()->where('user_id', $userId)->get(['project', 'key']);

        if ($existing->pluck('project')->unique()->count() >= self::MAX_PROJECTS) {
            throw new LocalWorkspaceException(LocalWorkspaceException::TOO_MANY_PROJECTS, 422, 'name');
        }

        $base = Str::limit(trim(Str::slug($name), '-'), 34, '');
        $base = $base === '' ? 'project' : $base;
        $keys = count($folders) === 1 ? [$base] : array_map(fn (int $n): string => $n === 0 ? $base : "{$base}-".($n + 1), array_keys($folders));
        $taken = array_merge(array_keys((array) config('ai-chat.local_workspace.roots', [])), $existing->pluck('key')->all());

        if ($existing->contains('project', $name) || array_intersect($keys, $taken) !== []) {
            throw new LocalWorkspaceException(LocalWorkspaceException::NAME_TAKEN, 422, 'name');
        }

        $paths = [];

        foreach ($folders as $folder) {
            $real = $this->importableFolder($folder);

            if (in_array($real, $paths, true)) {
                throw new LocalWorkspaceException(LocalWorkspaceException::FOLDER_DUPLICATE, 422, 'folders');
            }

            $paths[] = $real;
        }

        DB::transaction(function () use ($userId, $name, $keys, $paths): void {
            foreach ($paths as $index => $path) {
                AiLocalRoot::query()->create(['user_id' => $userId, 'project' => $name, 'key' => $keys[$index], 'path' => $path]);
            }
        });
        unset($this->rootCache[$userId]);
    }

    /**
     * Removes the whole project that owns `$key`, only among the signed-in person's own rows.
     *
     * @throws LocalWorkspaceException
     */
    public function removeProject(string $key): void
    {
        $userId = (int) Auth::id();
        $row = AiLocalRoot::query()->where('user_id', $userId)->where('key', $key)->first() ?? throw new LocalWorkspaceException(LocalWorkspaceException::UNKNOWN_ROOT, 404);

        AiLocalRoot::query()->where('user_id', $userId)->where('project', $row->project)->delete();
        unset($this->rootCache[$userId]);
    }

    /** * Realpath of a folder the person may import, or a refusal with a fixed message. */
    public function importableFolder(string $folder): string
    {
        $path = rtrim($folder, '/');

        if ($path === '' || strlen($folder) > 500 || preg_match('/[\x00-\x1f\x7f\\\\]/', $folder) === 1 || ! str_starts_with($path, '/') || in_array('..', explode('/', $path), true)) {
            throw new LocalWorkspaceException(LocalWorkspaceException::BAD_FOLDER, 422, 'folders');
        }

        $real = realpath($path);

        if ($real === false || ! is_dir($real)) {
            throw new LocalWorkspaceException(LocalWorkspaceException::BAD_FOLDER, 422, 'folders');
        }

        if ($real !== $path) {
            throw new LocalWorkspaceException(LocalWorkspaceException::FOLDER_LINK, 422, 'folders');
        }

        if ($this->locationRefused($real)) {
            throw new LocalWorkspaceException(LocalWorkspaceException::FOLDER_NOT_ALLOWED, 422, 'folders');
        }

        return $real;
    }

    /**
     * The folder the person picked in the browser's own dialog, found again on this machine: a browser tells only the folder's name and what is directly inside it, never its path. Looks for folders of that name inside the allowed bases and keeps the one holding the listed entries.
     *
     * @param  list<string>  $entries  names directly inside the picked folder
     *
     * @throws LocalWorkspaceException
     */
    public function findFolder(string $name, array $entries): string
    {
        if ($name === '' || strlen($name) > 100 || $name === '.' || $name === '..' || preg_match('#[/\x00-\x1f\x7f\\\\]#', $name) === 1) {
            throw new LocalWorkspaceException(LocalWorkspaceException::BAD_FOLDER, 422, 'folders');
        }

        $entries = array_values(array_filter($entries, fn (string $entry): bool => $entry !== '' && strlen($entry) <= 255 && $entry !== '..' && preg_match('#[/\x00-\x1f\x7f\\\\]#', $entry) !== 1));
        $deadline = microtime(true) + 4.0;
        $visited = 0;
        $found = [];
        $unreadable = [];

        foreach ($this->importBases() as $base) {
            $queue = [[$base, 0]];

            while ($queue !== [] && $visited < self::FIND_MAX_DIRS && microtime(true) < $deadline) {
                [$dir, $depth] = array_shift($queue);
                $visited++;

                $children = @scandir($dir);

                if ($children === false) {
                    // * Typically macOS refusing this process access to Documents/Desktop/Downloads.
                    $unreadable[] = $dir;

                    continue;
                }

                foreach ($children as $child) {
                    $path = $dir.'/'.$child;

                    if ($child[0] === '.' || in_array(strtolower($child), self::FIND_SKIP, true) || is_link($path) || ! is_dir($path)) {
                        continue;
                    }

                    // * macOS stores accented names decomposed while a browser sends them composed: compare them in one form.
                    if ($this->sameName($child, $name) && ! $this->locationRefused($path)) {
                        $score = count(array_filter($entries, fn (string $entry): bool => file_exists($path.'/'.$entry)));
                        $found[] = ['path' => $path, 'score' => $entries === [] ? 1.0 : $score / count($entries)];
                    }

                    if ($depth < self::FIND_MAX_DEPTH) {
                        $queue[] = [$path, $depth + 1];
                    }
                }
            }
        }

        // * Only folders that really hold what the dialog showed; several equally good ones cannot be told apart.
        $found = array_values(array_filter($found, fn (array $candidate): bool => $candidate['score'] >= 0.8));
        usort($found, fn (array $a, array $b): int => $b['score'] <=> $a['score']);

        if ($found === [] && $unreadable !== []) {
            throw new LocalWorkspaceException(sprintf(LocalWorkspaceException::FOLDER_UNREADABLE, $unreadable[0]), 500, 'folders');
        }

        if ($found === []) {
            throw new LocalWorkspaceException(sprintf(LocalWorkspaceException::FOLDER_NOT_FOUND, $name, implode(', ', $this->importBases())), 404, 'folders');
        }

        if (count($found) > 1 && $found[0]['score'] === $found[1]['score']) {
            throw new LocalWorkspaceException(LocalWorkspaceException::FOLDER_AMBIGUOUS, 422, 'folders');
        }

        return $this->importableFolder($found[0]['path']);
    }

    private function sameName(string $a, string $b): bool
    {
        if (class_exists(\Normalizer::class)) {
            $a = (string) \Normalizer::normalize($a, \Normalizer::FORM_C);
            $b = (string) \Normalizer::normalize($b, \Normalizer::FORM_C);
        }

        return $a === $b;
    }

    /** * True when the (already resolved) folder is outside the allowed bases, is a base itself, a system location or inside a sensitive folder. */
    private function locationRefused(string $real): bool
    {
        foreach (self::SYSTEM_PREFIXES as $prefix) {
            if ($real === $prefix || str_starts_with($real, $prefix.'/')) {
                return true;
            }
        }

        foreach (explode('/', strtolower($real)) as $segment) {
            if (in_array($segment, self::SENSITIVE_FOLDERS, true) || str_starts_with($segment, '.env')) {
                return true;
            }
        }

        foreach ($this->importBases() as $base) {
            if (str_starts_with($real, $base.'/')) {
                return false;
            }
        }

        return true;
    }

    /** @return list<string> realpaths of the allowed bases; the home folder when none is configured */
    private function importBases(): array
    {
        $configured = (array) config('ai-chat.local_workspace.import_bases', []);
        $bases = $configured === [] ? [CliRuntime::home()] : array_map('strval', $configured);
        $resolved = [];

        foreach ($bases as $base) {
            $real = $base === '' ? false : realpath($base);

            if ($real !== false && $real !== '/') {
                $resolved[] = rtrim($real, '/');
            }
        }

        return $resolved;
    }

    /** @return Collection<int, AiLocalRoot> */
    private function importedRows(): Collection
    {
        try {
            return AiLocalRoot::query()->where('user_id', Auth::id())->orderBy('id')->get();
        } catch (QueryException) {
            // * The table does not exist yet (migration not run): no imported roots.
            return new Collection;
        }
    }

    /**
     * Env roots plus the person's own imported ones. Imported folders are re-checked against the location policy on every use.
     *
     * @return array<string, string>
     */
    private function configuredRoots(): array
    {
        $userId = (int) Auth::id();

        return $this->rootCache[$userId] ??= $this->resolveRoots();
    }

    /** @return array<string, string> */
    private function resolveRoots(): array
    {
        $roots = array_filter((array) config('ai-chat.local_workspace.roots', []), fn (mixed $path, mixed $id): bool => is_string($path) && is_string($id) && realpath($path) !== false && is_dir($path), ARRAY_FILTER_USE_BOTH);

        foreach ($this->importedRows() as $row) {
            $real = realpath($row->path);

            if (isset($roots[$row->key]) || $real === false || ! is_dir($real) || $this->locationRefused($real)) {
                continue;
            }

            $roots[$row->key] = $real;
        }

        return $roots;
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

    /**
     * Raw bytes of one allowed image (same guards as `read`: denied names, links leaving the root, size limit).
     *
     * @throws LocalWorkspaceException
     */
    public function readImage(string $rootId, string $path): string
    {
        $full = $this->existingFile($rootId, $path);
        $size = filesize($full);

        if ($size === false || $size > ImageFiles::MAX_BYTES) {
            throw new LocalWorkspaceException(LocalWorkspaceException::TOO_LARGE);
        }

        $bytes = file_get_contents($full);

        if ($bytes === false) {
            throw new LocalWorkspaceException(LocalWorkspaceException::NOT_TEXT);
        }

        return $bytes;
    }

    /**
     * Files that differ from `HEAD` in the root's git working tree (read-only `git status`/`git diff`), without the files the deny list hides.
     *
     * @return array{git: bool, files: list<array{path: string, status: string, added: int|null, removed: int|null}>}
     */
    public function changes(string $rootId): array
    {
        $root = $this->rootPath($rootId);
        $status = Process::path($root)->timeout(15)->run(['git', '--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);

        if (! $status->successful()) {
            return ['git' => false, 'files' => []];
        }

        $counts = [];
        $numstat = Process::path($root)->timeout(15)->run(['git', '--no-optional-locks', 'diff', 'HEAD', '--numstat', '-z']);

        if ($numstat->successful()) {
            foreach (explode("\0", $numstat->output()) as $row) {
                if (preg_match('/^(\d+|-)\t(\d+|-)\t(.+)$/s', $row, $match) === 1) {
                    $counts[$match[3]] = $match[1] === '-' ? [null, null] : [(int) $match[1], (int) $match[2]];
                }
            }
        }

        $files = [];
        $entries = explode("\0", $status->output());

        for ($index = 0; $index < count($entries) && count($files) < self::MAX_CHANGES; $index++) {
            if (strlen($entries[$index]) < 4) {
                continue;
            }

            $code = substr($entries[$index], 0, 2);
            $path = substr($entries[$index], 3);

            // * A rename or copy is followed by the old path.
            if (str_contains($code, 'R') || str_contains($code, 'C')) {
                $index++;
            }

            $relative = $this->normalise($path);

            if ($relative === null || $this->denied($relative)) {
                continue;
            }

            $kind = $code === '??' || str_contains($code, 'A') ? 'A' : (str_contains($code, 'D') ? 'D' : 'M');
            [$added, $removed] = $counts[$path] ?? [null, null];

            if ($code === '??') {
                $added = $this->lineCount($root.DIRECTORY_SEPARATOR.$relative);
                $removed = 0;
            }

            $files[] = ['path' => $relative, 'status' => $kind, 'added' => $added, 'removed' => $removed];
        }

        usort($files, fn (array $a, array $b): int => strcmp($a['path'], $b['path']));

        return ['git' => true, 'files' => $files];
    }

    /** * The file as it is in `HEAD` (null for a file that is not in it), under the same guards as `read`. */
    public function headContent(string $rootId, string $path): ?string
    {
        $relative = $this->allowedRelative($path);
        $result = Process::path($this->rootPath($rootId))->timeout(15)->run(['git', 'show', 'HEAD:'.$relative]);

        if (! $result->successful()) {
            return null;
        }

        $content = $result->output();

        if (strlen($content) > self::MAX_READ_BYTES) {
            throw new LocalWorkspaceException(LocalWorkspaceException::TOO_LARGE);
        }

        if (str_contains($content, "\0") || ! mb_check_encoding($content, 'UTF-8')) {
            throw new LocalWorkspaceException(LocalWorkspaceException::NOT_TEXT);
        }

        return $content;
    }

    /** * Lines of a small new text file, null when it is large, binary or unreadable. */
    private function lineCount(string $full): ?int
    {
        $size = is_file($full) && ! is_link($full) ? filesize($full) : false;

        if ($size === false || $size > self::MAX_READ_BYTES) {
            return null;
        }

        $content = file_get_contents($full);

        if ($content === false || str_contains($content, "\0")) {
            return null;
        }

        return $content === '' ? 0 : substr_count($content, "\n") + (str_ends_with($content, "\n") ? 0 : 1);
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
        $activity = app(ChatActivity::class);
        $activity->record('tree', "local {$rootId}", count($paths).' tệp');
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
            $activity->record('file', "local {$rootId}", $path);
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

    /**
     * Make sure a folder (and its parents) exists inside the root, one segment at a time and never through a link. Used only for fixed folders of the app (`.agents/skills/<name>`).
     *
     * @throws LocalWorkspaceException
     */
    public function ensureFolder(string $rootId, string $relative): void
    {
        $root = $this->rootPath($rootId);
        $current = $root;

        foreach (explode('/', $this->normalise($relative) ?? throw new LocalWorkspaceException(LocalWorkspaceException::BAD_PATH)) as $segment) {
            $current .= DIRECTORY_SEPARATOR.$segment;

            if (is_link($current)) {
                throw new LocalWorkspaceException(LocalWorkspaceException::BAD_PATH);
            }

            if (! is_dir($current) && ! @mkdir($current, 0755)) {
                throw new LocalWorkspaceException(LocalWorkspaceException::WRITE_FAILED, 500);
            }
        }

        $this->assertInside($root, (string) realpath($current));
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
