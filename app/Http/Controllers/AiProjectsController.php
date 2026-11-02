<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Jobs\CloneRepoJob;
use App\Models\AiProject;
use App\Services\Ai\RepoCheckout;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** * Code tab: the GitHub repos an admin added to the project list. Only the `owner/name` is stored; nothing on GitHub is touched. */
class AiProjectsController extends Controller
{
    private const REPO_RULE = ['required', 'string', 'regex:/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/'];

    public function __construct(private readonly RepoCheckout $checkout) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json(['projects' => AiProject::query()->where('user_id', $request->user()->getKey())->orderBy('id')->pluck('repo')->all()]);
    }

    /** * Adds the repo to the list (adding one that is already there changes nothing) and clones it to this machine. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['repo' => self::REPO_RULE]);

        $project = AiProject::query()->firstOrCreate(['user_id' => $request->user()->getKey(), 'repo' => $data['repo']]);

        // * A repo added now is cloned to `storage/app/repos` once the response is sent.
        if ($project->wasRecentlyCreated) {
            $this->checkout->register($data['repo']);
            CloneRepoJob::dispatchAfterResponse($data['repo']);
        }

        return response()->json(['ok' => true], 201);
    }

    /** * Takes the repo out of the list and out of `.gitmodules`; its chats, the clone on disk and GitHub are not touched here. */
    public function destroy(Request $request): JsonResponse
    {
        $data = $request->validate(['repo' => self::REPO_RULE]);

        AiProject::query()->where('user_id', $request->user()->getKey())->where('repo', $data['repo'])->delete();
        $this->checkout->unregister($data['repo']);

        return response()->json(['ok' => true]);
    }
}
