<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Admin;
use App\Models\File;
use GdImage;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\Permission\Models\Role;
use Symfony\Component\Finder\Finder;
use ZipArchive;

class FileController extends Controller
{
    private const CACHE_DIR = '.cache/files';

    private const MAX_BATCH_KB = 102400;

    private const DEFAULT_MAX_UPLOAD_KB = 20480;

    // * Mime types by category; picks the LIMIT_FILE entry.
    private const TYPE_FILE = [
        'image' => ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'],
        'document' => [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain',
            'text/csv',
        ],
        'archive' => ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'],
        'audio' => ['audio/mpeg', 'audio/wav'],
        'video' => ['video/mp4', 'video/quicktime', 'video/webm'],
    ];

    // * Max upload size (KB) per category; unmatched types use DEFAULT_MAX_UPLOAD_KB.
    private const LIMIT_FILE = [
        'image' => 10240,
        'document' => 51200,
        'archive' => 204800,
        'audio' => 102400,
        'video' => 512000,
    ];

    private const ALLOWED_EXTENSIONS = [
        'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp',
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv',
        'zip', 'rar', '7z',
        'mp3', 'wav', 'mp4', 'mov', 'webm',
    ];

    private const SORT_COLUMNS = [
        'name' => 'name',
        'created_at' => 'created_at',
        'size' => 'size',
    ];

    private function typeFor(?string $mimeType): ?string
    {
        foreach (self::TYPE_FILE as $type => $mimeTypes) {
            if (in_array($mimeType, $mimeTypes, true)) {
                return $type;
            }
        }

        return null;
    }

    private function maxUploadKbFor(?string $mimeType): int
    {
        $type = $this->typeFor($mimeType);

        return $type ? self::LIMIT_FILE[$type] : self::DEFAULT_MAX_UPLOAD_KB;
    }

    /** * Write access is implicit for the folder owner and system admins, otherwise only via role_files grants. */
    private function authorizeWrite(Admin $admin, ?int $parentId): void
    {
        if (! $parentId) {
            abort_unless(File::permissionsForRoot($admin)['write'], 403, __('You do not have write access to root.'));

            return;
        }

        $parent = File::folders()->visibleTo($admin)->findOrFail($parentId);

        abort_unless($parent->isWritableBy($admin), 403, __('You do not have write access to this folder.'));
    }

    public function index(Request $request): Response
    {
        $admin = $request->user();
        $parentId = $request->integer('folder') ?: null;
        $search = $request->string('search')->trim()->toString();
        $sort = $request->string('sort')->toString();
        $sort = array_key_exists($sort, self::SORT_COLUMNS) ? $sort : 'name';
        $direction = $request->string('direction')->toString() === 'desc' ? 'desc' : 'asc';

        // ! A folder hidden from this admin can't be browsed into, even by id.
        $currentFolder = $parentId
            ? File::folders()->visibleTo($admin)->findOrFail($parentId)
            : null;

        $items = File::query()
            ->visibleTo($admin)
            ->when($search, function ($query) use ($search) {
                $query->where(function ($query) use ($search) {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('original_name', 'like', "%{$search}%");
                });
            }, function ($query) use ($parentId) {
                $query->where('parent_id', $parentId);
            })
            ->orderByRaw("type = 'folder' desc")
            ->orderBy(self::SORT_COLUMNS[$sort], $direction)
            ->paginate(24)
            ->withQueryString()
            ->through(fn (File $file) => [
                ...$file->toArray(),
                'shared' => $file->isFolder() ? $file->roleGrants()->exists() : null,
                'can_manage_permissions' => $file->canManagePermissions($admin),
            ]);

        return Inertia::render('file-manager/index', [
            'files' => $items,
            'search' => $search,
            'sort' => $sort,
            'direction' => $direction,
            'folderId' => $parentId,
            'breadcrumbs' => $currentFolder?->breadcrumbs() ?? [],
            'cacheSize' => $this->cacheSize(),
            'isSystemAdmin' => (bool) $admin->system_admin,
        ]);
    }

    /** * JSON image list for embedded pickers (RichTextEditor); `index()` always renders the full Inertia page. */
    public function picker(Request $request): JsonResponse
    {
        $admin = $request->user();
        $search = $request->string('search')->trim()->toString();

        $items = File::files()
            ->visibleTo($admin)
            ->whereIn('mime_type', self::TYPE_FILE['image'])
            ->when($search, fn ($query) => $query->where(function ($query) use ($search) {
                $query->where('name', 'like', "%{$search}%")
                    ->orWhere('original_name', 'like', "%{$search}%");
            }))
            ->orderByDesc('created_at')
            ->paginate(24)
            ->through(fn (File $file) => [
                'id' => $file->id,
                'name' => $file->name,
                'url' => $file->url,
            ]);

        return response()->json(['data' => $items->items(), 'meta' => ['total' => $items->total()]]);
    }

    public function thumbnail(int $id)
    {
        $file = File::files()->findOrFail($id);

        if (! $file->isImage()) {
            abort(404);
        }

        $disk = Storage::disk('public');
        $cachePath = $this->cachePathFor($file);

        if (! $disk->exists($cachePath) && ! $this->cacheThumbnail($file)) {
            return redirect($file->url);
        }

        return redirect($disk->url($cachePath));
    }

    private function cachePathFor(File $file): string
    {
        // * Thumbnails are always re-encoded as JPEG.
        return self::CACHE_DIR.'/'.pathinfo($file->path, PATHINFO_FILENAME).'.jpg';
    }

    private function cacheThumbnail(File $file): bool
    {
        if (! $file->isImage()) {
            return false;
        }

        $disk = Storage::disk('public');

        if (! $disk->exists(self::CACHE_DIR)) {
            $disk->makeDirectory(self::CACHE_DIR);
        }

        return $this->resizeAndSaveJpeg(
            $disk->path($file->path),
            $file->mime_type,
            $disk->path($this->cachePathFor($file)),
        );
    }

    private function forgetThumbnail(File $file): void
    {
        $disk = Storage::disk('public');
        $cachePath = $this->cachePathFor($file);

        if ($disk->exists($cachePath)) {
            $disk->delete($cachePath);
        }
    }

    public function clearCache(): RedirectResponse
    {
        Storage::disk('public')->deleteDirectory(self::CACHE_DIR);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Image cache cleared.')]);

        return back();
    }

    private function cacheSize(): int
    {
        $disk = Storage::disk('public');

        if (! $disk->exists(self::CACHE_DIR)) {
            return 0;
        }

        return collect($disk->allFiles(self::CACHE_DIR))
            ->sum(fn (string $path) => $disk->size($path));
    }

    private function resizeAndSaveJpeg(string $sourcePath, ?string $mimeType, string $destinationPath, int $maxDimension = 400): bool
    {
        $image = $this->loadGdImage($sourcePath, $mimeType);

        if (! $image) {
            return false;
        }

        $width = imagesx($image);
        $height = imagesy($image);
        $scale = min(1, $maxDimension / max($width, $height));

        if ($scale < 1) {
            $thumbWidth = (int) round($width * $scale);
            $thumbHeight = (int) round($height * $scale);
            $thumb = imagecreatetruecolor($thumbWidth, $thumbHeight);
            imagecopyresampled($thumb, $image, 0, 0, 0, 0, $thumbWidth, $thumbHeight, $width, $height);
            imagedestroy($image);
            $image = $thumb;
        }

        $saved = imagejpeg($image, $destinationPath, 70);
        imagedestroy($image);

        return $saved;
    }

    private function loadGdImage(string $sourcePath, ?string $mimeType): GdImage|false|null
    {
        return match ($mimeType) {
            'image/jpeg' => @imagecreatefromjpeg($sourcePath),
            'image/png' => @imagecreatefrompng($sourcePath),
            'image/webp' => @imagecreatefromwebp($sourcePath),
            'image/gif' => @imagecreatefromgif($sourcePath),
            default => null,
        } ?: null;
    }

    public function trash(Request $request): Response
    {
        $items = File::onlyTrashed()
            ->orderByRaw("type = 'folder' desc")
            ->orderByDesc('deleted_at')
            ->paginate(24)
            ->withQueryString();

        return Inertia::render('file-manager/trash', [
            'files' => $items,
        ]);
    }

    public function restore(int $id): RedirectResponse
    {
        $file = File::onlyTrashed()->findOrFail($id);
        $file->restore();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Restored.')]);

        return back();
    }

    public function storeFolder(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'parent_id' => ['nullable', 'integer', 'exists:files,id'],
        ]);

        $this->authorizeWrite($request->user(), $validated['parent_id'] ?? null);

        File::create([
            'type' => 'folder',
            'name' => $validated['name'],
            'parent_id' => $validated['parent_id'] ?? null,
            'created_by' => $request->user()?->id,
        ]);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Folder created.')]);

        return back();
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'files' => ['required', 'array', 'min:1'],
            'files.*' => [
                'file',
                'mimes:'.implode(',', self::ALLOWED_EXTENSIONS),
            ],
            'parent_id' => ['nullable', 'integer', 'exists:files,id'],
        ]);

        $this->authorizeWrite($request->user(), $validated['parent_id'] ?? null);

        $uploads = $request->file('files');
        $totalKb = collect($uploads)->sum(fn (UploadedFile $file) => $file->getSize() / 1024);

        if ($totalKb > self::MAX_BATCH_KB) {
            return back()->withErrors([
                'files' => __('Total upload size (:total MB) exceeds the :max MB limit per batch.', [
                    'total' => round($totalKb / 1024, 1),
                    'max' => round(self::MAX_BATCH_KB / 1024),
                ]),
            ]);
        }

        foreach ($uploads as $uploaded) {
            $maxKb = $this->maxUploadKbFor($uploaded->getClientMimeType());

            if ($uploaded->getSize() / 1024 > $maxKb) {
                return back()->withErrors([
                    'files' => __(':name exceeds the :max MB limit for this file type.', [
                        'name' => $uploaded->getClientOriginalName(),
                        'max' => round($maxKb / 1024),
                    ]),
                ]);
            }
        }

        $parentId = $request->input('parent_id');

        foreach ($request->file('files') as $uploaded) {
            $originalName = $uploaded->getClientOriginalName();
            $extension = Str::lower($uploaded->getClientOriginalExtension());
            $name = pathinfo($originalName, PATHINFO_FILENAME);

            $existing = File::files()
                ->where('parent_id', $parentId)
                ->where('name', $name)
                ->first();

            $path = $existing?->path ?? $this->targetPath($originalName);
            $this->storeAt($uploaded, $path);
            $size = Storage::disk('public')->size($path);

            $attributes = [
                'original_name' => $originalName,
                'path' => $path,
                'disk' => 'public',
                'mime_type' => $uploaded->getClientMimeType(),
                'extension' => $extension,
                'size' => $size,
                'created_by' => $request->user()?->id,
            ];

            if ($existing) {
                $existing->update($attributes);
                $this->forgetThumbnail($existing);
                $file = $existing;
            } else {
                $file = File::create($attributes + [
                    'type' => 'file',
                    'parent_id' => $parentId,
                    'name' => $name,
                ]);
            }

            $this->cacheThumbnail($file);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Files uploaded.')]);

        return back();
    }

    /** * Overwrites any existing file at `$path`. */
    private function storeAt(UploadedFile $uploaded, string $path): void
    {
        $disk = Storage::disk('public');
        $directory = dirname($path);

        if ($directory !== '.' && ! $disk->exists($directory)) {
            $disk->makeDirectory($directory);
        }

        $absolutePath = $disk->path($path);

        if (! $this->optimizeImageTo($uploaded->getRealPath(), $uploaded->getClientMimeType(), $absolutePath)) {
            $disk->putFileAs('', $uploaded, $path);
        }
    }

    /** * Returns false for unsupported types so the caller stores the file as-is. */
    private function optimizeImageTo(string $sourcePath, ?string $mimeType, string $destinationPath): bool
    {
        $image = $this->loadGdImage($sourcePath, $mimeType);

        if (! $image) {
            return false;
        }

        $saved = match ($mimeType) {
            'image/jpeg' => imagejpeg($image, $destinationPath, 82),
            'image/png' => (imagesavealpha($image, true) && imagepng($image, $destinationPath, 6)),
            'image/webp' => imagewebp($image, $destinationPath, 82),
            default => false,
        };

        imagedestroy($image);

        return $saved;
    }

    /** * "Photo.PNG" -> "files/photo.png". */
    private function targetPath(string $originalName): string
    {
        $filename = pathinfo($originalName, PATHINFO_FILENAME);
        $extension = pathinfo($originalName, PATHINFO_EXTENSION);

        return 'files/'.Str::slug($filename).($extension ? '.'.Str::lower($extension) : '');
    }

    public function update(Request $request, File $file): RedirectResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'alt' => ['nullable', 'string', 'max:255'],
        ]);

        $this->authorizeWrite($request->user(), $file->parent_id);

        $file->update($validated);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Updated.')]);

        return back();
    }

    public function bulkDestroy(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'exists:files,id'],
        ]);

        $admin = $request->user();
        $items = File::query()->whereIn('id', $validated['ids'])->get();

        foreach ($items as $item) {
            $this->authorizeWrite($admin, $item->parent_id);
        }

        foreach ($items as $item) {
            if (! $item->isFolder()) {
                $this->forgetThumbnail($item);
            }

            $item->delete();
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Deleted.')]);

        return back();
    }

    /** * Children cascade only on force delete. */
    public function destroy(Request $request, File $file): RedirectResponse
    {
        $this->authorizeWrite($request->user(), $file->parent_id);

        if (! $file->isFolder()) {
            $this->forgetThumbnail($file);
        }

        $file->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Deleted.')]);

        return back();
    }

    public function extract(int $id): RedirectResponse
    {
        $zipFile = File::files()->findOrFail($id);

        if ($zipFile->extension !== 'zip') {
            Inertia::flash('toast', ['type' => 'error', 'message' => __('Only .zip files can be extracted.')]);

            return back();
        }

        $zip = new ZipArchive;
        $absoluteZipPath = Storage::disk($zipFile->disk)->path($zipFile->path);

        if ($zip->open($absoluteZipPath) !== true) {
            Inertia::flash('toast', ['type' => 'error', 'message' => __('Could not open the zip file.')]);

            return back();
        }

        $tempDir = storage_path('app/tmp/extract-'.Str::uuid());
        $zip->extractTo($tempDir);
        $zip->close();

        $rootFolder = File::create([
            'type' => 'folder',
            'name' => $zipFile->name,
            'parent_id' => $zipFile->parent_id,
            'created_by' => auth()->id(),
        ]);

        $this->importExtractedDirectory($tempDir, $rootFolder);

        (new Filesystem)->deleteDirectory($tempDir);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Extracted.')]);

        return back();
    }

    private function importExtractedDirectory(string $localDir, File $parentFolder): void
    {
        $finder = (new Finder)->in($localDir)->depth(0)->sortByName();

        foreach ($finder->directories() as $dir) {
            $subFolder = File::create([
                'type' => 'folder',
                'name' => $dir->getFilename(),
                'parent_id' => $parentFolder->id,
                'created_by' => auth()->id(),
            ]);

            $this->importExtractedDirectory($dir->getPathname(), $subFolder);
        }

        foreach ($finder->files() as $entry) {
            $originalName = $entry->getFilename();
            $extension = Str::lower($entry->getExtension());
            $path = 'extracted/'.Str::uuid().($extension ? '.'.$extension : '');

            Storage::disk('public')->put($path, $entry->getContents());

            File::create([
                'type' => 'file',
                'parent_id' => $parentFolder->id,
                'name' => pathinfo($originalName, PATHINFO_FILENAME),
                'original_name' => $originalName,
                'path' => $path,
                'disk' => 'public',
                'mime_type' => mime_content_type($entry->getPathname()) ?: null,
                'extension' => $extension,
                'size' => $entry->getSize(),
                'created_by' => auth()->id(),
            ]);
        }
    }

    public function download(int $id)
    {
        $file = File::files()->findOrFail($id);

        return Storage::disk($file->disk)->download($file->path, $file->original_name ?? $file->name);
    }

    public function downloadZip(Request $request)
    {
        $ids = array_filter(explode(',', (string) $request->query('ids', '')));
        $items = File::query()->whereIn('id', $ids)->get();

        if ($items->isEmpty()) {
            return back();
        }

        $zipPath = storage_path('app/tmp/download-'.Str::uuid().'.zip');

        if (! is_dir(dirname($zipPath))) {
            mkdir(dirname($zipPath), 0755, true);
        }

        $zip = new ZipArchive;
        $zip->open($zipPath, ZipArchive::CREATE);

        $usedNames = [];

        foreach ($items as $item) {
            if ($item->isFolder()) {
                $this->addFolderToZip($zip, $item, $this->uniqueZipName($item->name, $usedNames));
            } else {
                $this->addFileToZip($zip, $item, $this->uniqueZipName($item->original_name ?? $item->name, $usedNames));
            }
        }

        $zip->close();

        $downloadName = $items->count() === 1
            ? pathinfo($items->first()->name, PATHINFO_FILENAME).'.zip'
            : (Str::slug((string) $request->query('name', 'files')) ?: 'files').'.zip';

        return response()->download($zipPath, $downloadName)->deleteFileAfterSend();
    }

    private function addFileToZip(ZipArchive $zip, File $file, string $entryName): void
    {
        $zip->addFile(Storage::disk($file->disk)->path($file->path), $entryName);
    }

    private function addFolderToZip(ZipArchive $zip, File $folder, string $entryPrefix): void
    {
        $zip->addEmptyDir($entryPrefix);

        $usedNames = [];

        foreach ($folder->children as $child) {
            if ($child->isFolder()) {
                $this->addFolderToZip($zip, $child, $entryPrefix.'/'.$this->uniqueZipName($child->name, $usedNames));
            } else {
                $this->addFileToZip($zip, $child, $entryPrefix.'/'.$this->uniqueZipName($child->original_name ?? $child->name, $usedNames));
            }
        }
    }

    /** * "photo.jpg" -> "photo-1.jpg" when the name is taken at the same level. */
    private function uniqueZipName(string $name, array &$usedNames): string
    {
        if (! isset($usedNames[$name])) {
            $usedNames[$name] = 0;

            return $name;
        }

        $usedNames[$name]++;
        $extension = pathinfo($name, PATHINFO_EXTENSION);
        $base = pathinfo($name, PATHINFO_FILENAME);

        return $base.'-'.$usedNames[$name].($extension ? '.'.$extension : '');
    }

    public function duplicate(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'exists:files,id'],
            'target_id' => ['nullable', 'integer', 'exists:files,id'],
        ]);

        $items = File::query()->whereIn('id', $validated['ids'])->get();
        $targetProvided = array_key_exists('target_id', $validated);

        foreach ($items as $item) {
            $this->duplicateItem($item, $targetProvided ? $validated['target_id'] : $item->parent_id);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Duplicated.')]);

        return back();
    }

    private function duplicateItem(File $item, ?int $parentId): File
    {
        if ($item->isFolder()) {
            $copy = File::create([
                'type' => 'folder',
                'name' => $this->uniqueSiblingName($item->name, $parentId),
                'parent_id' => $parentId,
                'created_by' => auth()->id(),
            ]);

            foreach ($item->children as $child) {
                $this->duplicateItem($child, $copy->id);
            }

            return $copy;
        }

        $disk = Storage::disk($item->disk);
        $extension = $item->extension ? '.'.$item->extension : '';
        $newPath = 'files/'.Str::uuid().$extension;

        $disk->copy($item->path, $newPath);

        return File::create([
            'type' => 'file',
            'parent_id' => $parentId,
            'name' => $this->uniqueSiblingName($item->name, $parentId),
            'original_name' => $item->original_name,
            'path' => $newPath,
            'disk' => $item->disk,
            'mime_type' => $item->mime_type,
            'extension' => $item->extension,
            'size' => $item->size,
            'alt' => $item->alt,
            'created_by' => auth()->id(),
        ]);
    }

    /** * Appends "-copy", "-copy-2", ... until the name is free among siblings. */
    private function uniqueSiblingName(string $name, ?int $parentId): string
    {
        $candidate = $name.'-copy';
        $suffix = 1;

        while (File::query()->where('parent_id', $parentId)->where('name', $candidate)->exists()) {
            $suffix++;
            $candidate = $name.'-copy-'.$suffix;
        }

        return $candidate;
    }

    /** * Stores the archive next to the items instead of downloading it. */
    public function compress(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'exists:files,id'],
            'name' => ['nullable', 'string', 'max:255'],
        ]);

        $items = File::query()->whereIn('id', $validated['ids'])->get();

        if ($items->isEmpty()) {
            return back();
        }

        $parentId = $items->first()->parent_id;
        $name = Str::slug($validated['name'] ?? 'archive') ?: 'archive';
        $path = 'files/'.Str::uuid().'.zip';
        $absolutePath = Storage::disk('public')->path($path);

        if (! Storage::disk('public')->exists('files')) {
            Storage::disk('public')->makeDirectory('files');
        }

        $zip = new ZipArchive;
        $zip->open($absolutePath, ZipArchive::CREATE);

        $usedNames = [];

        foreach ($items as $item) {
            if ($item->isFolder()) {
                $this->addFolderToZip($zip, $item, $this->uniqueZipName($item->name, $usedNames));
            } else {
                $this->addFileToZip($zip, $item, $this->uniqueZipName($item->original_name ?? $item->name, $usedNames));
            }
        }

        $zip->close();

        File::create([
            'type' => 'file',
            'parent_id' => $parentId,
            'name' => $this->uniqueSiblingName($name, $parentId),
            'original_name' => $name.'.zip',
            'path' => $path,
            'disk' => 'public',
            'mime_type' => 'application/zip',
            'extension' => 'zip',
            'size' => Storage::disk('public')->size($path),
            'created_by' => auth()->id(),
        ]);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Compressed.')]);

        return back();
    }

    public function move(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'exists:files,id'],
            'target_id' => ['nullable', 'integer', 'exists:files,id'],
        ]);

        $admin = $request->user();
        $targetId = $validated['target_id'] ?? null;
        $target = $targetId ? File::folders()->findOrFail($targetId) : null;

        $this->authorizeWrite($admin, $targetId);

        foreach ($validated['ids'] as $id) {
            $item = File::findOrFail($id);

            if ($item->id === $targetId) {
                continue;
            }

            if ($item->isFolder() && $target && $this->isDescendantOf($target, $item)) {
                return back()->withErrors(['target_id' => __('Cannot move a folder into its own subfolder.')]);
            }

            $this->authorizeWrite($admin, $item->parent_id);

            $item->update(['parent_id' => $targetId]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Moved.')]);

        return back();
    }

    private function isDescendantOf(File $folder, File $ancestor): bool
    {
        $node = $folder;

        while ($node) {
            if ($node->id === $ancestor->id) {
                return true;
            }

            $node = $node->parent;
        }

        return false;
    }

    public function folderTree(): JsonResponse
    {
        return response()->json(
            File::folders()->orderBy('name')->get(['id', 'name', 'parent_id']),
        );
    }

    /** * `$id` 0 = the file manager root. */
    public function permissions(Request $request, int $id): JsonResponse
    {
        $admin = $request->user();

        if ($id === 0) {
            abort_unless(File::canManageRootPermissions($admin), 403);

            $granted = DB::table('role_files')->whereNull('folder_id')
                ->get(['role_id', 'can_read', 'can_write', 'can_delete'])
                ->mapWithKeys(fn ($grant) => [
                    $grant->role_id => [
                        'read' => (bool) $grant->can_read,
                        'write' => (bool) $grant->can_write,
                        'delete' => (bool) $grant->can_delete,
                    ],
                ]);
        } else {
            $folder = File::folders()->visibleTo($admin)->findOrFail($id);

            abort_unless($folder->canManagePermissions($admin), 403);

            $granted = $folder->roleGrants()->get(['roles.id'])->mapWithKeys(fn (Role $role) => [
                $role->id => [
                    'read' => (bool) $role->pivot->can_read,
                    'write' => (bool) $role->pivot->can_write,
                    'delete' => (bool) $role->pivot->can_delete,
                ],
            ]);
        }

        return response()->json([
            'roles' => Role::query()->orderBy('name')->get(['id', 'name']),
            'permissions' => $granted,
        ]);
    }

    /** * `$id` 0 = the file manager root. */
    public function updatePermissions(Request $request, int $id): RedirectResponse
    {
        $admin = $request->user();

        $validated = $request->validate([
            'grants' => ['array'],
            'grants.*.role_id' => ['required', 'integer', 'exists:roles,id'],
            'grants.*.read' => ['boolean'],
            'grants.*.write' => ['boolean'],
            'grants.*.delete' => ['boolean'],
        ]);

        if ($id === 0) {
            abort_unless(File::canManageRootPermissions($admin), 403);

            DB::transaction(function () use ($validated) {
                DB::table('role_files')->whereNull('folder_id')->delete();

                foreach ($validated['grants'] ?? [] as $grant) {
                    DB::table('role_files')->insert([
                        'role_id' => $grant['role_id'],
                        'folder_id' => null,
                        'can_read' => $grant['read'] ?? false,
                        'can_write' => $grant['write'] ?? false,
                        'can_delete' => $grant['delete'] ?? false,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }
            });
        } else {
            $folder = File::folders()->visibleTo($admin)->findOrFail($id);

            abort_unless($folder->canManagePermissions($admin), 403);

            $sync = collect($validated['grants'] ?? [])->mapWithKeys(fn (array $grant) => [
                $grant['role_id'] => [
                    'can_read' => $grant['read'] ?? false,
                    'can_write' => $grant['write'] ?? false,
                    'can_delete' => $grant['delete'] ?? false,
                ],
            ]);

            $folder->roleGrants()->sync($sync);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Đã cập nhật phân quyền.')]);

        return back();
    }

    public function forceDestroy(int $id): RedirectResponse
    {
        $file = File::withTrashed()->findOrFail($id);

        if (! $file->isFolder() && $file->path) {
            Storage::disk($file->disk)->delete($file->path);
            $this->forgetThumbnail($file);
        }

        $file->forceDelete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Permanently deleted.')]);

        return back();
    }
}
