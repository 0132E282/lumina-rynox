<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\ImportLocalProjectRequest;
use App\Services\Ai\ImageFiles;
use App\Services\Ai\LocalWorkspace;
use App\Services\Ai\LocalWorkspaceException;
use App\Support\ResourcePermission;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** * Side of the AI chat's "Máy local" source: which folders exist (ids only), their file list and one file's text. Writing happens through an approved proposal or the person's own save of an open file. */
class LocalWorkspaceController extends Controller
{
    public function __construct(private readonly LocalWorkspace $workspace) {}

    public function status(Request $request): JsonResponse
    {
        $refusal = $this->workspace->refusal($request);

        return response()->json([
            'enabled' => $refusal === null,
            'message' => $refusal,
            'roots' => $refusal === null ? $this->workspace->roots() : [],
            'projects' => $refusal === null ? $this->workspace->projects() : [],
            'can_read' => ResourcePermission::allows($request->user(), 'ai', 'local-read'),
            'can_write' => ResourcePermission::allows($request->user(), 'ai', 'local-write'),
        ]);
    }

    public function storeProject(ImportLocalProjectRequest $request): JsonResponse
    {
        $data = $request->validated();

        return $this->changed($request, fn () => $this->workspace->importProject($data['name'], $data['folders']), 201);
    }

    public function findFolder(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'entries' => ['present', 'array', 'max:200'],
            'entries.*' => ['string', 'max:255'],
        ]);

        return $this->guarded($request, fn (): array => ['folder' => $this->workspace->findFolder($data['name'], $data['entries'])]);
    }

    public function destroyProject(Request $request, string $key): JsonResponse
    {
        return $this->changed($request, fn () => $this->workspace->removeProject($key), 200);
    }

    public function tree(Request $request): JsonResponse
    {
        $data = $request->validate(['root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/']]);

        return $this->guarded($request, fn (): array => $this->workspace->tree($data['root']));
    }

    public function file(Request $request): JsonResponse
    {
        $data = $request->validate([
            'root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/'],
            'path' => ['required', 'string', 'max:300'],
        ]);

        $mime = ImageFiles::mime($data['path']);

        return $this->guarded($request, fn (): array => $mime === null
            ? ['path' => $data['path'], 'content' => $this->workspace->read($data['root'], $data['path'])]
            : ['path' => $data['path'], 'image' => ImageFiles::dataUrl($mime, $this->workspace->readImage($data['root'], $data['path']))]);
    }

    public function changes(Request $request): JsonResponse
    {
        $data = $request->validate(['root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/']]);

        return $this->guarded($request, fn (): array => $this->workspace->changes($data['root']));
    }

    public function branches(Request $request): JsonResponse
    {
        $data = $request->validate(['root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/']]);

        return $this->guarded($request, fn (): array => $this->workspace->branches($data['root']));
    }

    public function head(Request $request): JsonResponse
    {
        $data = $request->validate([
            'root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/'],
            'path' => ['required', 'string', 'max:300'],
        ]);

        return $this->guarded($request, function () use ($data): array {
            $content = $this->workspace->headContent($data['root'], $data['path']);

            return ['path' => $data['path'], 'content' => $content ?? '', 'tracked' => $content !== null];
        });
    }

    /** * Runs one Terminal command in a local project's folder (output, exit code, timeout flag). */
    public function exec(Request $request): JsonResponse
    {
        $data = $request->validate([
            'root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/'],
            'command' => ['required', 'string', 'max:2000'],
        ]);

        return $this->guarded($request, fn (): array => $this->workspace->run($data['root'], $data['command']));
    }

    /** * Saves the person's own edit of one file: same guards and atomic write as an approved proposal; `original` is the text the editor started from, a different file on disk is a 409. */
    public function save(Request $request): JsonResponse
    {
        $data = $request->validate([
            'root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/'],
            'path' => ['required', 'string', 'max:300'],
            'content' => ['present', 'nullable', 'string'],
            'original' => ['present', 'nullable', 'string'],
        ]);

        return $this->guarded($request, function () use ($data): array {
            $this->workspace->write($data['root'], $data['path'], $data['content'] ?? '', LocalWorkspace::hash($data['original'] ?? ''));

            return ['path' => $data['path']];
        });
    }

    /**
     * Import/remove: same guards as the reads; a refusal of a folder is a 422 on its form field. Answers with the fresh roots and projects.
     *
     * @param  callable(): void  $action
     */
    private function changed(Request $request, callable $action, int $status): JsonResponse
    {
        if (($refusal = $this->workspace->refusal($request)) !== null) {
            return response()->json(['message' => $refusal], 403);
        }

        try {
            $action();
        } catch (LocalWorkspaceException $exception) {
            return response()->json(['message' => $exception->getMessage(), 'errors' => $exception->field === null ? [] : [$exception->field => [$exception->getMessage()]]], $exception->status);
        }

        return response()->json(['roots' => $this->workspace->roots(), 'projects' => $this->workspace->projects()], $status);
    }

    /** @param callable(): array<string, mixed> $action */
    private function guarded(Request $request, callable $action): JsonResponse
    {
        if (($refusal = $this->workspace->refusal($request)) !== null) {
            return response()->json(['message' => $refusal], 403);
        }

        try {
            return response()->json($action());
        } catch (LocalWorkspaceException $exception) {
            return response()->json(['message' => $exception->getMessage()], $exception->status);
        }
    }
}
