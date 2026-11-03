<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\ImportLocalProjectRequest;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Ai\GithubException;
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

    /** * Saves the person's own edit of one file: same guards and atomic write as an approved proposal; the editor saves by itself, so what the person typed replaces the file even if it changed on disk meanwhile. */
    public function save(Request $request): JsonResponse
    {
        $data = $request->validate([
            'root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/'],
            'path' => ['required', 'string', 'max:300'],
            'content' => ['present', 'nullable', 'string'],
            'original' => ['nullable', 'string'],
        ]);

        return $this->guarded($request, function () use ($data): array {
            $this->workspace->write($data['root'], $data['path'], $data['content'] ?? '', $this->workspace->currentHash($data['root'], $data['path']));

            return ['path' => $data['path']];
        });
    }

    /** * "Hoàn tác thay đổi" of the change list: the file goes back to git `HEAD` (a new file is removed). */
    public function discard(Request $request): JsonResponse
    {
        $data = $request->validate([
            'root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/'],
            'path' => ['required', 'string', 'max:300'],
        ]);

        return $this->guarded($request, function () use ($data, $request): array {
            $this->workspace->discard($data['root'], $data['path']);
            activity()->causedBy($request->user())->event('ai-chat.local-discard')->withProperties(['root' => $data['root'], 'path' => $data['path']])->log('Hoàn tác thay đổi một tệp');

            return ['path' => $data['path']];
        });
    }

    /**
     * "Tạo bằng AI" in the commit box: a title and description written from the diff of the listed files.
     * ! The diff of the change list is sent to the picked AI account, only when the person presses the button; nothing is stored.
     */
    public function commitMessage(Request $request, AiAssistant $assistant): JsonResponse
    {
        $data = $request->validate([
            'root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/'],
            'ai_account_id' => ['nullable', 'integer'],
            'ai_model' => ['nullable', 'string', 'max:100'],
        ]);

        return $this->guarded($request, function () use ($data, $assistant): array {
            try {
                return $assistant->commitMessage($this->workspace->diffForCommit($data['root']), isset($data['ai_account_id']) ? (int) $data['ai_account_id'] : null, $data['ai_model'] ?? null);
            } catch (AiException $exception) {
                throw new LocalWorkspaceException($exception->userMessage(), 422);
            }
        });
    }

    /** * "Commit" of the change list: one local commit of the listed files with the typed message (never a push). */
    public function commit(Request $request): JsonResponse
    {
        $data = $request->validate([
            'root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/'],
            'message' => ['required', 'string', 'max:200'],
        ]);

        return $this->guarded($request, function () use ($data, $request): array {
            $result = $this->workspace->commit($data['root'], trim($data['message']));
            activity()->causedBy($request->user())->event('ai-chat.local-commit')->withProperties(['root' => $data['root'], 'hash' => $result['hash'], 'files' => $result['files']])->log('Commit các thay đổi của một dự án local');

            return $result;
        });
    }

    /**
     * "Pull request": a new branch with the listed files, pushed to origin, and the pull request on GitHub.
     * ! Leaves the machine (push and GitHub API); only on the person's press, and every run is logged.
     */
    public function pullRequest(Request $request): JsonResponse
    {
        $data = $request->validate([
            'root' => ['required', 'string', 'regex:/^[a-z0-9_-]{1,40}$/'],
            'title' => ['required', 'string', 'max:200'],
            'body' => ['nullable', 'string', 'max:5000'],
            'base' => ['nullable', 'string', 'max:100', 'regex:/^[\w.\/-]+$/'],
        ]);

        return $this->guarded($request, function () use ($data, $request): array {
            try {
                $result = $this->workspace->pullRequest($data['root'], trim($data['title']), trim($data['body'] ?? ''), $data['base'] ?? null);
            } catch (GithubException $exception) {
                throw new LocalWorkspaceException($exception->getMessage(), 422);
            }

            activity()->causedBy($request->user())->event('ai-chat.local-pull-request')->withProperties(['root' => $data['root'], 'branch' => $result['branch'], 'hash' => $result['hash'], 'files' => $result['files']])->log('Push nhánh và tạo Pull request từ một dự án local');

            return $result;
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
