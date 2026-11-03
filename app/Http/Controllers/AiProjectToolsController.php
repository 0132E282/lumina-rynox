<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\AiProjectTool;
use App\Services\Ai\GithubException;
use App\Services\Ai\LocalWorkspace;
use App\Services\Ai\LocalWorkspaceException;
use App\Services\Ai\ProjectTools;
use App\Support\ResourcePermission;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** * "Cài đặt chat" > Skill / Agent / MCP: list, switch on or off per project, and create skills and subagents in a local project's shared `.agents/` folder. MCP servers can only be switched, never added. */
class AiProjectToolsController extends Controller
{
    private const PROJECT_RULE = ['required', 'string', 'regex:/^(?:local:[a-z0-9_-]{1,40}|[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100})$/'];

    public function __construct(private readonly ProjectTools $tools, private readonly LocalWorkspace $workspace) {}

    public function index(Request $request): JsonResponse
    {
        // * `global` = no project picked: the machine-wide skills, subagents and MCP servers.
        $project = $request->validate(['project' => ['required', 'string', 'regex:/^(?:global|local:[a-z0-9_-]{1,40}|[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100})$/']])['project'];
        $user = $request->user();
        $none = $project === ProjectTools::GLOBAL;
        $local = ! $none && $this->tools->isLocal($project);
        $catalog = ['skills' => [], 'agents' => []];
        $message = null;

        if ($local && ! ResourcePermission::allows($user, 'ai', 'local-read')) {
            $message = 'Bạn chưa có quyền đọc tệp local.';
        } elseif ($local && ($refusal = $this->workspace->refusal($request)) !== null) {
            $message = $refusal;
        } elseif (! $none) {
            try {
                $catalog = $this->tools->catalog($project);
            } catch (LocalWorkspaceException|GithubException $exception) {
                $message = $exception->getMessage();
            }
        }

        // * Machine-wide skills are files of the server's own home folder: only where the local workspace itself is allowed (loopback, not production) and readable.
        $global = ResourcePermission::allows($user, 'ai', 'local-read') && $this->workspace->refusal($request) === null;

        $globalSkills = $global ? $this->tools->globalSkills() : [];
        $globalAgents = $global ? $this->tools->globalAgents() : [];

        return response()->json([
            ...$catalog,
            'global_skills' => $globalSkills,
            'global_agents' => $globalAgents,
            'mcp' => $this->tools->mcpServers(),
            'enabled' => [
                'skill' => $this->tools->active($user, $project, 'skill', array_column($catalog['skills'], 'name')),
                'agent' => $this->tools->active($user, $project, 'agent', array_column($catalog['agents'], 'name')),
                'mcp' => $this->tools->active($user, $project, 'mcp'),
                'global_skill' => $this->tools->active($user, ProjectTools::GLOBAL, 'skill', array_column($globalSkills, 'name')),
                'global_agent' => $this->tools->active($user, ProjectTools::GLOBAL, 'agent', array_column($globalAgents, 'name')),
                'global_mcp' => $this->tools->active($user, ProjectTools::GLOBAL, 'mcp'),
            ],
            'can_create' => $local && $message === null && ResourcePermission::allows($user, 'ai', 'local-write'),
            'message' => $message,
        ]);
    }

    /** * Rules and hooks of a project (read-only tabs): same permission and local guards as the catalog. */
    public function info(Request $request): JsonResponse
    {
        $project = $request->validate(['project' => self::PROJECT_RULE])['project'];
        $empty = ['rules' => [], 'hooks' => [], 'message' => null];

        if ($this->tools->isLocal($project)) {
            if (! ResourcePermission::allows($request->user(), 'ai', 'local-read')) {
                return response()->json([...$empty, 'message' => 'Bạn chưa có quyền đọc tệp local.']);
            }

            if (($refusal = $this->workspace->refusal($request)) !== null) {
                return response()->json([...$empty, 'message' => $refusal]);
            }
        }

        try {
            return response()->json([...$empty, ...$this->tools->rulesAndHooks($project)]);
        } catch (LocalWorkspaceException|GithubException $exception) {
            return response()->json([...$empty, 'message' => $exception->getMessage()]);
        }
    }

    public function toggle(Request $request): JsonResponse
    {
        $global = $request->input('project') === ProjectTools::GLOBAL;
        $data = $request->validate([
            'project' => $global ? ['required', Rule::in([ProjectTools::GLOBAL])] : self::PROJECT_RULE,
            'kind' => $global ? ['required', Rule::in(['skill', 'agent', 'mcp'])] : ['required', Rule::in(AiProjectTool::KINDS)],
            'name' => ['required', 'string', $request->input('kind') === 'mcp' ? 'regex:/^[A-Za-z0-9_.: -]{1,80}$/' : 'regex:'.($global ? ProjectTools::GLOBAL_NAME_PATTERN : ProjectTools::NAME_PATTERN)],
            'on' => ['required', 'boolean'],
        ]);

        $this->tools->toggle($request->user(), $data['project'], $data['kind'], $data['name'], (bool) $data['on']);

        return response()->json(['ok' => true]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'project' => ['required', 'string', 'regex:/^local:[a-z0-9_-]{1,40}$/'],
            'kind' => ['required', Rule::in(['skill', 'agent'])],
            'name' => ['required', 'string', 'regex:'.ProjectTools::NAME_PATTERN],
            'description' => ['required', 'string', 'max:300'],
            'body' => ['required', 'string', 'max:20000'],
        ]);

        if (($refusal = $this->workspace->refusal($request)) !== null) {
            return response()->json(['message' => $refusal], 403);
        }

        try {
            $path = $this->tools->create($data['project'], $data['kind'], $data['name'], $data['description'], $data['body']);
        } catch (LocalWorkspaceException $exception) {
            // * An existing file of that name is a conflict (never overwritten).
            return response()->json(['message' => $exception->getMessage(), 'errors' => ['name' => [$exception->getMessage()]]], $exception->status);
        }

        return response()->json(['path' => $path], 201);
    }
}
