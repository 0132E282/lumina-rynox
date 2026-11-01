<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Ai\LocalWorkspace;
use App\Services\Ai\LocalWorkspaceException;
use App\Support\ResourcePermission;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** * Read-only side of the AI chat's "Máy local" source: which folders exist (ids only), their file list and one file's text. Writing happens only through an approved proposal. */
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
            'can_read' => ResourcePermission::allows($request->user(), 'ai', 'local-read'),
            'can_write' => ResourcePermission::allows($request->user(), 'ai', 'local-write'),
        ]);
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

        return $this->guarded($request, fn (): array => ['path' => $data['path'], 'content' => $this->workspace->read($data['root'], $data['path'])]);
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
