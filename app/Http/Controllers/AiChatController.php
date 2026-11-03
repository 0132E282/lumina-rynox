<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\SendAiChatMessageRequest;
use App\Models\Admin;
use App\Models\AiAccount;
use App\Models\AiChangeProposal;
use App\Models\AiChatSetting;
use App\Models\AiConversation;
use App\Models\AiMessage;
use App\Models\AiUsageLog;
use App\Services\Ai\AgentWorkspace;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Ai\AiUsageStats;
use App\Services\Ai\ApiLlmClient;
use App\Services\Ai\ChatActivity;
use App\Services\Ai\ChatAttachmentReader;
use App\Services\Ai\ChatImages;
use App\Services\Ai\EditProposalExtractor;
use App\Services\Ai\GithubException;
use App\Services\Ai\GithubReader;
use App\Services\Ai\GithubWriter;
use App\Services\Ai\ImageFiles;
use App\Services\Ai\LocalWorkspace;
use App\Services\Ai\LocalWorkspaceException;
use App\Services\Ai\McpPolicy;
use App\Services\Ai\ProjectTools;
use App\Services\Integrations\IntegrationManager;
use App\Support\LineDiff;
use App\Support\ResourcePermission;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * * Home-page AI chat (`/`). History is stored per admin; every lookup is scoped by `user_id`, so another admin's thread is a 404.
 * * Answers come from `AiAssistant::chat` (synchronous, no queue). A failed AI call stores nothing, so no thread is left with an unanswered message.
 */
class AiChatController extends Controller
{
    private const RECENTS = 30;

    private const THREAD_MESSAGES = 200;

    private const HISTORY_MESSAGES = 20;

    private const RECENTS_CACHE_SECONDS = 300;

    /** `repo` of a proposal aimed at a local folder is `local:{root id}`. */
    private const LOCAL_PREFIX = 'local:';

    public function __construct(private readonly AiAssistant $assistant, private readonly GithubReader $github, private readonly GithubWriter $githubWriter, private readonly ChatAttachmentReader $attachments, private readonly EditProposalExtractor $extractor, private readonly IntegrationManager $integrations, private readonly LocalWorkspace $workspace, private readonly ProjectTools $tools) {}

    /** * Without `ai.use` the home page has nothing to show, so the person goes to the dashboard instead of a 403 right after login. */
    public function index(Request $request): Response|RedirectResponse
    {
        $user = $request->user();

        if (! ResourcePermission::allows($user, 'ai', 'use')) {
            return redirect()->route('dashboard');
        }

        $active = null;
        $messages = [];

        if ($request->query('c') !== null) {
            $active = AiConversation::query()->ownedBy($user)->where('uuid', (string) $request->query('c'))->firstOrFail();
            $messages = $active->messages()->with('proposals')->latest('id')->limit(self::THREAD_MESSAGES)->get()->reverse()->values()
                ->map(fn (AiMessage $message): array => $this->messagePayload($message))->all();
        }

        // * Closures: opening a conversation asks only for `activeConversation` and `messages`, so the recents, accounts and the rest are not even queried then.
        $accounts = null;
        $loadAccounts = function () use (&$accounts) {
            return $accounts ??= AiAccount::query()->orderBy('priority')->orderBy('id')->get();
        };

        return Inertia::render('ai-chat/index', [
            'conversations' => fn () => $this->recents($user),
            'activeConversation' => $active === null ? null : $this->conversationPayload($active),
            'messages' => $messages,
            'aiAccounts' => fn () => $this->accountsPayload($loadAccounts()),
            'aiAccountList' => fn () => $this->accountListPayload($user, $loadAccounts()),
            'githubConnected' => fn () => $this->github->connected(),
            'settings' => fn () => AiChatSetting::payloadFor($user),
            'chatContext' => fn () => ['system_chars' => $this->assistant->chatSystemPromptLength(), 'window_tokens' => AiAssistant::CONTEXT_WINDOW_TOKENS],
            'integrations' => fn () => ResourcePermission::allows($user, 'integrations', 'view') ? $this->integrationsPayload() : null,
        ]);
    }

    /**
     * Name, logo and status of every integration for the session panel. Never credentials: only what `IntegrationManager::overview()` already exposes to the overview page.
     *
     * @return array<int, array{key: string, name: string, letter: string, color: string, status: string, status_label: string}>
     */
    private function integrationsPayload(): array
    {
        return collect($this->integrations->overview())->flatMap(fn (array $group): array => $group['providers'])
            ->map(fn (array $provider): array => ['key' => $provider['key'], 'name' => $provider['name'], 'letter' => $provider['letter'], 'color' => $provider['color'], 'status' => $provider['status'], 'status_label' => $provider['status_label']])
            ->values()->all();
    }

    /** * Cache key of one admin's Recents list; always contains the user id, so a list is never served to anyone else. */
    public static function recentsCacheKey(int $userId): string
    {
        return "ai-chat:recents:{$userId}";
    }

    /**
     * The latest conversations of this admin, cached briefly. The query stays scoped by `ownedBy($user)`; `send()` drops the key whenever a thread is created or touched.
     *
     * @return array<int, array<string, mixed>>
     */
    private function recents(Admin $user): array
    {
        return Cache::remember(self::recentsCacheKey($user->id), self::RECENTS_CACHE_SECONDS, fn (): array => AiConversation::query()->ownedBy($user)->whereNull('parent_id')->latest('updated_at')->latest('id')->limit(self::RECENTS)->get()
            ->map(fn (AiConversation $conversation): array => $this->conversationPayload($conversation))->all());
    }

    /** * Deletes one of the signed-in admin's threads with its messages and edit proposals (cascade); another admin's thread is a 404. */
    public function destroyConversation(Request $request, string $conversation): RedirectResponse
    {
        $user = $request->user();

        AiConversation::query()->ownedBy($user)->where('uuid', $conversation)->firstOrFail()->delete();
        Cache::forget(self::recentsCacheKey($user->id));

        return redirect()->route('home');
    }

    /** * Deletes every thread of one list: `chat` (no project), `code` (with a project) or `repo` (one project's threads). Only the signed-in admin's own threads. */
    public function destroyConversations(Request $request): RedirectResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'scope' => ['required', 'in:chat,code,repo'],
            'repo' => ['required_if:scope,repo', 'string', 'max:140', 'regex:#^(?:local:[a-z0-9_-]{1,40}|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$#'],
        ]);

        $query = AiConversation::query()->ownedBy($user);

        match ($data['scope']) {
            'chat' => $query->whereNull('repo'),
            'code' => $query->whereNotNull('repo'),
            'repo' => $query->where('repo', $data['repo']),
        };
        $query->delete();
        Cache::forget(self::recentsCacheKey($user->id));

        return redirect()->route('home');
    }

    /** * Repos the saved GitHub token can read (for the picker under the chat box). Names and flags only. */
    public function repos(): JsonResponse
    {
        if (! $this->github->connected()) {
            return response()->json(['connected' => false, 'repos' => []]);
        }

        try {
            return response()->json(['connected' => true, 'repos' => $this->github->repos()]);
        } catch (GithubException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    /** * File paths of a repo for the read-only code viewer. */
    public function tree(Request $request): JsonResponse
    {
        $data = $request->validate([
            'repo' => ['required', 'string', 'max:140', 'regex:#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#'],
            'branch' => ['nullable', 'string', 'max:200', 'regex:#^[A-Za-z0-9._/-]+$#', 'not_regex:#(^|/)\.\.(/|$)#'],
        ]);

        try {
            return response()->json($this->github->browse($data['repo'], $data['branch'] ?? null));
        } catch (GithubException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    /** * Branches of a repo for the branch popup (read-only). */
    public function branches(Request $request): JsonResponse
    {
        $data = $request->validate(['repo' => ['required', 'string', 'max:140', 'regex:#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#']]);

        try {
            return response()->json($this->github->branches($data['repo']));
        } catch (GithubException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    /** * Text of one file of a repo for the code viewer (read-only). */
    public function file(Request $request): JsonResponse
    {
        $data = $request->validate([
            'repo' => ['required', 'string', 'max:140', 'regex:#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#'],
            'path' => ['required', 'string', 'max:300', 'not_regex:#(^|/)\.\.(/|$)#', 'not_regex:#^/#'],
            'branch' => ['nullable', 'string', 'max:200', 'regex:#^[A-Za-z0-9._/-]+$#', 'not_regex:#(^|/)\.\.(/|$)#'],
        ]);

        $mime = ImageFiles::mime($data['path']);

        try {
            if ($mime !== null) {
                $bytes = $this->github->readImage($data['repo'], $data['path'], $data['branch'] ?? null);

                return $bytes === null
                    ? response()->json(['message' => 'Không xem được ảnh này (quá lớn hoặc không đọc được, tối đa 1 MB).'], 422)
                    : response()->json(['path' => $data['path'], 'image' => ImageFiles::dataUrl($mime, $bytes)]);
            }

            $content = $this->github->readFile($data['repo'], $data['path'], $data['branch'] ?? null);
        } catch (GithubException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return $content === null
            ? response()->json(['message' => 'Không xem được tệp này (không phải văn bản nhỏ).'], 422)
            : response()->json(['path' => $data['path'], 'content' => $content]);
    }

    /** * "Thống kê AI": per-account usage (own call counts, shared status), loaded when the dialog opens so the page itself costs no extra query. */
    public function usage(Request $request, AiUsageStats $stats): JsonResponse
    {
        return response()->json($stats->forUser((int) $request->user()->getKey()));
    }

    /** * A clearer rewrite of the draft prompt; nothing is stored or sent anywhere else. */
    public function optimize(Request $request): JsonResponse
    {
        $data = $request->validate([
            'message' => ['required', 'string', 'max:'.SendAiChatMessageRequest::MAX_MESSAGE_LENGTH],
            'ai_account_id' => ['nullable', 'integer'],
            'ai_model' => ['nullable', 'string', 'max:100'],
        ]);

        try {
            $prompt = $this->assistant->optimizePrompt(trim($data['message']), isset($data['ai_account_id']) ? (int) $data['ai_account_id'] : null, $data['ai_model'] ?? null);
        } catch (AiException $exception) {
            return response()->json(['message' => $exception->userMessage()], 422);
        }

        return response()->json(['prompt' => $prompt]);
    }

    /**
     * The same send, answered as a stream of lines (`application/x-ndjson`): one `step` line for each thing the app does while it works, then one `done` line with the status and body `send` would have returned.
     * ! Validation and permission failed before this point as ordinary JSON; anything that goes wrong inside becomes a `done` line with its status, never a stack trace.
     */
    public function sendStream(SendAiChatMessageRequest $request): StreamedResponse
    {
        return response()->stream(function () use ($request): void {
            $emit = function (array $event): void {
                echo json_encode($event, JSON_UNESCAPED_UNICODE)."\n";

                if (ob_get_level() > 0) {
                    @ob_flush();
                }

                flush();
            };

            app(ChatActivity::class)->listen(fn (array $step) => $emit(['type' => 'step', ...$step]));
            app(ChatActivity::class)->listenPlan(fn (array $todos) => $emit(['type' => 'plan', 'todos' => $todos]));
            app(ChatActivity::class)->listenAgents(fn (array $agent) => $emit(['type' => 'agent', ...$agent]));

            try {
                $response = $this->send($request);
                $emit(['type' => 'done', 'status' => $response->getStatusCode(), 'data' => $response->getData(true)]);
            } catch (ModelNotFoundException) {
                $emit(['type' => 'done', 'status' => 404, 'data' => ['message' => 'Không tìm thấy cuộc trò chuyện.']]);
            } catch (\Throwable $exception) {
                report($exception);
                // * `report()` skips some exception types: the class and message (never sent to the page) always reach the log.
                Log::error('ai-chat.stream failed: '.$exception::class.': '.$exception->getMessage(), ['file' => $exception->getFile().':'.$exception->getLine()]);
                $emit(['type' => 'done', 'status' => 500, 'data' => ['message' => 'Không gọi được trợ lý AI.']]);
            }
        }, 200, ['Content-Type' => 'application/x-ndjson', 'Cache-Control' => 'no-cache', 'X-Accel-Buffering' => 'no']);
    }

    public function send(SendAiChatMessageRequest $request): JsonResponse
    {
        $user = $request->user();
        $text = trim($request->validated('message'));
        $conversationId = $request->validated('conversation_id');

        $conversation = $conversationId === null ? null : AiConversation::query()->ownedBy($user)->where('uuid', $conversationId)->firstOrFail();
        $history = $conversation === null ? [] : $this->history($conversation);
        $parentId = $conversation === null ? $this->parentId($request, $user) : null;

        // * Attached files and the repo go to the AI for this turn only; the thread keeps the text plus the names.
        $files = $request->file('attachments', []);
        $sections = [];
        $notes = [];
        // * Where the AI works: told to the AI only, never written into the person's message.
        $where = [];

        foreach ($files as $file) {
            // * A picture goes to the CLI as a file (for this request only); it has no text to read.
            if (ChatImages::isImage($file)) {
                app(ChatImages::class)->store($file);
                app(ChatActivity::class)->record('image', 'đính kèm', $file->getClientOriginalName());
                $sections[] = 'Ảnh đính kèm: '.$file->getClientOriginalName().' (gửi kèm cho AI)';
                $notes[] = '🖼 '.$file->getClientOriginalName();

                continue;
            }

            $content = $this->attachments->read($file);

            if ($content === null) {
                return response()->json(['message' => 'Không đọc được nội dung tệp "'.$file->getClientOriginalName().'".'], 422);
            }

            $sections[] = 'Tệp đính kèm: '.$file->getClientOriginalName()."\n".$content;
            app(ChatActivity::class)->record('attachment', 'đính kèm', $file->getClientOriginalName());
            $notes[] = '📎 '.$file->getClientOriginalName();
        }

        $repo = $request->validated('repo');
        $localRoot = $request->validated('local_root');
        $extraRepos = $request->validated('extra_repos') ?? [];
        $extraRoots = $request->validated('extra_local_roots') ?? [];

        if ($localRoot !== null || $extraRoots !== []) {
            if (! ResourcePermission::allows($user, 'ai', 'local-read')) {
                return response()->json(['message' => 'Bạn chưa có quyền đọc tệp local.'], 403);
            }

            if (($refusal = $this->workspace->refusal($request)) !== null) {
                return response()->json(['message' => $refusal], 422);
            }
        }

        // * The project the chat belongs to: a GitHub repo, or `local:<folder>` for a folder of this machine (so it is listed under that project).
        $project = $repo ?? ($localRoot === null ? null : self::LOCAL_PREFIX.$localRoot);

        // * An approved plan handed to the AI ("Duyệt và làm"): it works from the plan's task list in the message, so the project's file tree and files are not read for it.
        $planRun = preg_match('~^Plan docs/plans/[\w.-]+\.json đã được duyệt~u', $text) === 1;

        // * An approved plan on a GitHub project works in that repo's local clone (`storage/app/repos`), where the agents may edit files; never in the original repo.
        if ($planRun && $repo !== null) {
            app(AgentWorkspace::class)->useRepo($repo);
        }

        // * An approved plan on a local project works in that folder itself (the clone mechanism is for GitHub only); editing it needs the same permission as applying a local edit.
        if ($planRun && $localRoot !== null && ResourcePermission::allows($user, 'ai', 'local-write')) {
            app(AgentWorkspace::class)->useLocal($localRoot);
        }

        try {
            if ($localRoot !== null) {
                $planRun || $sections[] = $this->workspace->context($localRoot, $text);
                $where[] = 'local '.$localRoot;
            }

            if ($repo !== null) {
                $planRun || $sections[] = $this->github->context($repo, $text);
                $where[] = 'GitHub '.$repo;
            }

            // * More projects picked together are context only: edits are proposed against the first one.
            foreach ($extraRoots as $extraRoot) {
                $planRun || $sections[] = $this->workspace->context($extraRoot, $text);
                $where[] = 'local '.$extraRoot;
            }

            foreach ($extraRepos as $extraRepo) {
                $planRun || $sections[] = $this->github->context($extraRepo, $text);
                $where[] = 'GitHub '.$extraRepo;
            }

            if ($where !== []) {
                array_unshift($sections, 'Phạm vi làm việc: '.implode(', ', $where).'. Chỉ đọc và đề xuất sửa trong các dự án này, không làm việc ở nơi khác.');
            }

            // * Only the skills, subagents and MCP servers switched on for the picked projects reach the AI; every other MCP server stays blocked.
            $picked = array_values(array_filter([$localRoot === null ? null : self::LOCAL_PREFIX.$localRoot, $repo, ...array_map(fn (string $root): string => self::LOCAL_PREFIX.$root, $extraRoots), ...$extraRepos]));
            $tools = $this->tools->forChat($user, $picked, ResourcePermission::allows($user, 'ai', 'local-read') && $this->workspace->refusal($request) === null, $text);
            app(McpPolicy::class)->allow($tools['mcp']);

            if ($tools['section'] !== null) {
                $sections[] = $tools['section'];
            }

            app(ChatActivity::class)->record('ask', 'AI', 'Gửi yêu cầu cho AI và chờ trả lời');

            $answer = Str::limit($this->assistant->chat(
                $history,
                $text,
                $request->validated('ai_account_id') === null ? null : (int) $request->validated('ai_account_id'),
                $request->validated('ai_model'),
                $sections === [] ? null : implode("\n\n", $sections),
                $repo !== null || $localRoot !== null || $extraRepos !== [] || $extraRoots !== [],
                $request->validated('mode') ?? AiAssistant::MODE_AUTO,
                $this->promptProfile($user),
            ), AiMessage::MAX_CONTENT_LENGTH, '');
        } catch (AiException|GithubException|LocalWorkspaceException $exception) {
            // * A coding chat is kept even when the answer failed (quota, timeout...): the question stays in the project's list and the thread can go on.
            $kept = $project === null ? null : $this->keepFailedTurn($user, $conversation, $project, $notes === [] ? $text : $text."\n\n".implode(' · ', $notes), $parentId);

            return response()->json([
                'message' => $exception instanceof AiException ? $exception->userMessage() : $exception->getMessage(),
            ] + ($kept === null ? [] : ['conversation' => $this->conversationPayload($kept)]), 422);
        }

        $stored = $notes === [] ? $text : $text."\n\n".implode(' · ', $notes);

        // * Edits the AI proposed become pending proposals (diffed against the repo now); only the person's approval ever writes to GitHub.
        $proposals = [];

        if ($repo !== null) {
            ['text' => $answer, 'proposals' => $proposals] = $this->buildProposals($repo, $answer);
        } elseif ($localRoot !== null) {
            ['text' => $answer, 'proposals' => $proposals] = $this->buildLocalProposals($localRoot, $answer);
        }

        [$conversation, $userMessage, $assistantMessage] = DB::transaction(function () use ($user, $conversation, $text, $stored, $answer, $proposals, $project, $parentId): array {
            $conversation ??= AiConversation::query()->create(['user_id' => $user->id, 'parent_id' => $parentId, 'repo' => $project, 'title' => Str::limit(Str::squish($text), AiConversation::TITLE_LENGTH, '…')]);

            // * A general chat that turns to a repo joins that project from then on.
            if ($conversation->repo === null && $project !== null) {
                $conversation->update(['repo' => $project]);
            }

            $userMessage = $conversation->messages()->create(['role' => AiMessage::ROLE_USER, 'content' => $stored]);
            $assistantMessage = $conversation->messages()->create(['role' => AiMessage::ROLE_ASSISTANT, 'content' => $answer]);

            // * A new edit of a file replaces the older one still waiting in this chat: both were made against the same file, so approving one would leave the other out of date.
            if ($proposals !== []) {
                AiChangeProposal::query()
                    ->whereIn('ai_message_id', $conversation->messages()->select('id'))
                    ->where('status', AiChangeProposal::STATUS_PENDING)
                    ->whereIn('repo', array_unique(array_column($proposals, 'repo')))
                    ->whereIn('path', array_column($proposals, 'path'))
                    ->update(['status' => AiChangeProposal::STATUS_REJECTED]);
            }

            $assistantMessage->proposals()->createMany($proposals);
            $conversation->touch();

            return [$conversation, $userMessage, $assistantMessage];
        });

        // * After commit: the Recents list changed (new thread or new order), so the next page load must not see the cached one.
        Cache::forget(self::recentsCacheKey($user->id));

        // * "Tự tạo Pull Request": the edits go to a new branch + PR right away. A failure keeps them pending, so the person can still approve by hand.
        $autoPrError = null;

        if ($request->boolean('auto_pr') && $proposals !== []) {
            $auto = $this->openPullRequest($assistantMessage, 'tạo tự động theo cài đặt "Tự tạo Pull Request"');
            $autoPrError = $auto instanceof JsonResponse ? ($auto->getData(true)['message'] ?? GithubException::FAILED) : null;
        }

        // * Edits to a folder of this machine are written right away (unless the comment box holds them for a tick); a conflict or refusal leaves them pending for the person to review.
        if ($localRoot !== null && $proposals !== [] && ! $request->boolean('hold_edits')) {
            $this->applyLocalProposals($request, $assistantMessage);
        }

        return response()->json([
            'conversation' => $this->conversationPayload($conversation),
            'user_message' => $this->messagePayload($userMessage),
            'assistant_message' => $this->messagePayload($assistantMessage->load('proposals')),
            'auto_pr_error' => $autoPrError,
            // * Another AI answered because the picked one hit its quota: the page switches its picker to it.
            'answered_by' => $this->switchedTo($request),
            // * What the app read for this answer (names and counts only), shown in the agent popup.
            'activity' => app(ChatActivity::class)->all(),
        ]);
    }

    /** * Approve: one new branch with the pending edits and a pull request (never a write to the base branch). */
    public function applyProposals(Request $request, AiMessage $message): JsonResponse
    {
        $this->assertOwned($request, $message);

        $result = $this->openPullRequest($message, 'đã được duyệt thủ công');

        if ($result instanceof JsonResponse) {
            return $result;
        }

        return response()->json(['pull_url' => $result['pull_url'], 'proposals' => $this->proposalsPayload($message->fresh())]);
    }

    /**
     * The pending edits of one answer as one new branch + one pull request. Shared by the person's approval and the "tự tạo Pull Request" switch.
     *
     * @return array{pull_url: string}|JsonResponse
     */
    private function openPullRequest(AiMessage $message, string $approval): array|JsonResponse
    {
        return DB::transaction(function () use ($message, $approval): array|JsonResponse {
            $pending = $message->proposals()->where('status', AiChangeProposal::STATUS_PENDING)->where('repo', 'not like', self::LOCAL_PREFIX.'%')->lockForUpdate()->get();

            if ($pending->isEmpty()) {
                return response()->json(['message' => 'Không còn thay đổi nào đang chờ duyệt.'], 422);
            }

            $first = $pending->first();
            $branch = 'ai/chat-'.$message->id.'-'.now()->format('Ymd-His');

            try {
                $url = $this->githubWriter->openPullRequest(
                    $first->repo,
                    $first->base_branch,
                    $branch,
                    'AI: '.Str::limit($message->conversation->title, 60),
                    "Đề xuất bởi trợ lý AI trong Personal Manager, {$approval}.\n\nTệp:\n".$pending->map(fn (AiChangeProposal $proposal): string => "- {$proposal->path}")->implode("\n"),
                    $pending->map(fn (AiChangeProposal $proposal): array => ['path' => $proposal->path, 'content' => $proposal->content, 'sha' => $proposal->base_sha])->all(),
                );
            } catch (GithubException $exception) {
                return response()->json(['message' => $exception->getMessage()], 422);
            }

            $message->proposals()->whereIn('id', $pending->modelKeys())->update(['status' => AiChangeProposal::STATUS_APPLIED, 'pull_url' => $url]);

            return ['pull_url' => $url];
        });
    }

    /**
     * Approve edits aimed at a local folder: written only now, only to the paths stored with the proposal, and only if each file still matches the content the proposal was made from.
     */
    public function applyLocalProposals(Request $request, AiMessage $message): JsonResponse
    {
        $this->assertOwned($request, $message);

        if (($refusal = $this->workspace->refusal($request)) !== null) {
            return response()->json(['message' => $refusal], 422);
        }

        return DB::transaction(function () use ($request, $message): JsonResponse {
            $pending = $message->proposals()->where('status', AiChangeProposal::STATUS_PENDING)->where('repo', 'like', self::LOCAL_PREFIX.'%')->lockForUpdate()->get();

            if ($pending->isEmpty()) {
                return response()->json(['message' => 'Không còn thay đổi nào đang chờ duyệt.'], 422);
            }

            try {
                foreach ($pending as $proposal) {
                    $root = $this->rootOf($proposal);
                    // * The person applies what they see: a file edited since the proposal is overwritten, not refused.
                    $hashes = $this->workspace->write($root, $proposal->path, $proposal->content, $this->workspace->currentHash($root, $proposal->path));
                    $proposal->update(['status' => AiChangeProposal::STATUS_APPLIED]);

                    // * Audit: who wrote which relative path, hashes before/after; never the content.
                    activity()->causedBy($request->user())->event('ai-chat.local-write')
                        ->withProperties(['root' => $root, 'path' => $proposal->path, 'before' => $hashes['before'], 'after' => $hashes['after']])
                        ->log('Ghi tệp local từ đề xuất của trợ lý AI.');
                }
            } catch (LocalWorkspaceException $exception) {
                return response()->json(['message' => $exception->getMessage(), 'proposals' => $this->proposalsPayload($message->fresh())], $exception->status);
            }

            return response()->json(['proposals' => $this->proposalsPayload($message->fresh())]);
        });
    }

    /** * Undo edits already written to a local folder: each file goes back to the text before the edit, only while it is still exactly what the edit wrote. */
    public function revertLocalProposals(Request $request, AiMessage $message): JsonResponse
    {
        $this->assertOwned($request, $message);
        // * "force": the person confirmed that later edits of the file may go too; the file returns to the text before the AI's edit.
        $force = $request->boolean('force');

        if (($refusal = $this->workspace->refusal($request)) !== null) {
            return response()->json(['message' => $refusal], 422);
        }

        return DB::transaction(function () use ($request, $message, $force): JsonResponse {
            $applied = $message->proposals()->where('status', AiChangeProposal::STATUS_APPLIED)->where('repo', 'like', self::LOCAL_PREFIX.'%')->lockForUpdate()->get();

            if ($applied->isEmpty()) {
                return response()->json(['message' => 'Không có thay đổi nào để hoàn tác.'], 422);
            }

            try {
                // * Work out every file first so a file that cannot be restored writes nothing.
                $restored = [];

                foreach ($applied as $proposal) {
                    $root = $this->rootOf($proposal);
                    $before = $proposal->action === 'update' && $proposal->diff !== null ? LineDiff::restore($proposal->content, $proposal->diff) : null;

                    if ($before === null) {
                        throw new LocalWorkspaceException(LocalWorkspaceException::REVERT_UNAVAILABLE, 422);
                    }

                    if (! $force && $this->workspace->currentHash($root, $proposal->path) !== LocalWorkspace::hash($proposal->content)) {
                        throw new LocalWorkspaceException(LocalWorkspaceException::REVERT_CONFLICT, 409);
                    }

                    $restored[$proposal->id] = $before;
                }

                foreach ($applied as $proposal) {
                    $root = $this->rootOf($proposal);
                    $hashes = $this->workspace->write($root, $proposal->path, $restored[$proposal->id], $force ? $this->workspace->currentHash($root, $proposal->path) : LocalWorkspace::hash($proposal->content));
                    $proposal->update(['status' => AiChangeProposal::STATUS_REVERTED]);

                    activity()->causedBy($request->user())->event('ai-chat.local-revert')
                        ->withProperties(['root' => $root, 'path' => $proposal->path, 'before' => $hashes['before'], 'after' => $hashes['after']])
                        ->log('Hoàn tác tệp local đã được trợ lý AI sửa.');
                }
            } catch (LocalWorkspaceException $exception) {
                return response()->json(['message' => $exception->getMessage(), 'proposals' => $this->proposalsPayload($message->fresh())], $exception->status);
            }

            return response()->json(['proposals' => $this->proposalsPayload($message->fresh())]);
        });
    }

    /**
     * What personalises the prompt for this person (their own saved settings; their account name when no display name is set).
     *
     * @return array{name: string, custom_instructions: string|null, assistant_name: string|null}
     */
    private function promptProfile(Admin $user): array
    {
        $settings = AiChatSetting::forUser($user);

        return ['name' => $settings?->display_name ?: $user->name, 'custom_instructions' => $settings?->custom_instructions, 'assistant_name' => $settings?->assistant_name];
    }

    private function rootOf(AiChangeProposal $proposal): string
    {
        return substr($proposal->repo, strlen(self::LOCAL_PREFIX));
    }

    /** * Dismiss the pending edits of one answer; nothing is sent anywhere. */
    public function rejectProposals(Request $request, AiMessage $message): JsonResponse
    {
        $this->assertOwned($request, $message);

        $message->proposals()->where('status', AiChangeProposal::STATUS_PENDING)->update(['status' => AiChangeProposal::STATUS_REJECTED]);

        return response()->json(['proposals' => $this->proposalsPayload($message->fresh())]);
    }

    private function assertOwned(Request $request, AiMessage $message): void
    {
        abort_unless(AiConversation::query()->ownedBy($request->user())->whereKey($message->ai_conversation_id)->exists(), 404);
    }

    /**
     * @return array{text: string, proposals: list<array<string, mixed>>}
     */
    private function buildProposals(string $repo, string $answer): array
    {
        ['text' => $text, 'files' => $files] = $this->extractor->extract($answer);
        $proposals = [];
        $skipped = [];

        if ($files !== []) {
            try {
                $base = $this->github->defaultBranch($repo);
            } catch (GithubException) {
                return ['text' => $text."\n\n(Không đọc được repo để tạo đề xuất sửa file.)", 'proposals' => []];
            }
        }

        foreach (array_slice($files, 0, AiChangeProposal::MAX_FILES) as $file) {
            $path = AiChangeProposal::safePath($file['path']);

            if ($path === null || strlen($file['content']) > AiChangeProposal::MAX_CONTENT_BYTES) {
                $skipped[] = $file['path'];

                continue;
            }

            try {
                $current = $this->github->currentFile($repo, $base, $path);
            } catch (GithubException) {
                $skipped[] = $path;

                continue;
            }

            $proposals[] = [
                'repo' => $repo,
                'base_branch' => $base,
                'path' => $path,
                'action' => $current === null ? 'create' : 'update',
                'base_sha' => $current['sha'] ?? null,
                'content' => $file['content'],
                'diff' => LineDiff::unified($current['content'] ?? '', $file['content']),
            ];
        }

        if ($skipped !== []) {
            $text .= "\n\n(Bỏ qua vì đường dẫn không hợp lệ, quá lớn hoặc không đọc được: ".implode(', ', $skipped).').';
        }

        return ['text' => $text, 'proposals' => $proposals];
    }

    /**
     * Proposals for a local folder: the diff is against the file as it is now, and its hash is kept so applying can detect a change.
     *
     * @return array{text: string, proposals: list<array<string, mixed>>}
     */
    private function buildLocalProposals(string $root, string $answer): array
    {
        ['text' => $text, 'files' => $files] = $this->extractor->extract($answer);
        $proposals = [];
        $skipped = [];

        foreach (array_slice($files, 0, AiChangeProposal::MAX_FILES) as $file) {
            $path = $this->workspace->normalise($file['path']);

            if ($path === null || $this->workspace->denied($path) || strlen($file['content']) > LocalWorkspace::MAX_WRITE_BYTES) {
                $skipped[] = $file['path'];

                continue;
            }

            try {
                $hash = $this->workspace->currentHash($root, $path);
                $current = $hash === null ? '' : $this->workspace->read($root, $path);
            } catch (LocalWorkspaceException) {
                $skipped[] = $file['path'];

                continue;
            }

            $proposals[] = [
                'repo' => self::LOCAL_PREFIX.$root,
                'base_branch' => 'local',
                'path' => $path,
                'action' => $hash === null ? 'create' : 'update',
                'base_sha' => $hash,
                'content' => $file['content'],
                'diff' => LineDiff::unified($current, $file['content']),
            ];
        }

        if ($skipped !== []) {
            $text .= "\n\n(Bỏ qua vì đường dẫn bị chặn, quá lớn hoặc không đọc được: ".implode(', ', $skipped).').';
        }

        return ['text' => $text, 'proposals' => $proposals];
    }

    /** @return list<array{role: string, content: string}> the latest turns, oldest first */
    private function history(AiConversation $conversation): array
    {
        return array_values($conversation->messages()->latest('id')->limit(self::HISTORY_MESSAGES)->get()->reverse()
            ->map(fn (AiMessage $message): array => ['role' => $message->role, 'content' => $message->content])->all());
    }

    /**
     * Every AI account with safe fields only (never the token, session or last error), for the chat-settings dialog. Links and switches are only offered with the Integrations permissions.
     *
     * @param  Collection<int, AiAccount>  $accounts
     * @return array<string, mixed>
     */
    private function accountListPayload(Admin $user, Collection $accounts): array
    {
        return [
            'accounts' => $accounts->map(fn (AiAccount $account): array => [
                'id' => $account->id,
                'name' => $account->name,
                'vendor_key' => $account->vendor,
                'vendor' => AiAccount::VENDORS[$account->vendor] ?? $account->vendor,
                'status' => $account->status,
                'enabled' => $account->enabled,
                'priority' => $account->priority,
                'purposes' => $account->purposes,
                // * The same model list the composer offers for this account.
                'models' => collect($account->pickableModels())->map(fn (string $label, string $id): array => ['id' => $id, 'label' => $label])->values()->all(),
                'model' => $account->model,
            ])->values()->all(),
            'purposes' => collect(AiAccount::PURPOSES)->map(fn (string $label, string $key): array => ['key' => $key, 'label' => $label])->values()->all(),
            'purpose_accounts' => $this->purposeAccounts(),
            'can_view' => ResourcePermission::allows($user, 'integrations', 'view'),
            'can_update' => ResourcePermission::allows($user, 'integrations', 'update'),
        ];
    }

    /** @return array<string, list<array{account_id: int, model: string|null}>> */
    private function purposeAccounts(): array
    {
        return array_intersect_key($this->assistant->purposeChoices(), AiAccount::PURPOSES);
    }

    /**
     * * The enabled accounts that answer chat, in the order they are tried. Only display fields: never the token or the last error.
     *
     * @param  Collection<int, AiAccount>  $accounts
     * @return array<int, array{id: int, name: string, vendor_key: string, vendor: string, model: string|null, models: array<int, array{id: string, label: string}>, max_output_tokens: int|null, status: string}>
     */
    private function accountsPayload(Collection $accounts): array
    {
        try {
            // * The latest reset time each account's quota stops stated (statistics are optional: a missing column just means none).
            $resets = AiUsageLog::query()->where('status', AiUsageLog::STATUS_QUOTA)->whereNotNull('limit_reset_at')->groupBy('ai_account_id')
                ->selectRaw('ai_account_id, MAX(limit_reset_at) as reset_at')->pluck('reset_at', 'ai_account_id')->all();
        } catch (QueryException) {
            $resets = [];
        }

        return $accounts->where('enabled', true)
            ->filter(fn (AiAccount $account): bool => $account->allowsPurpose(AiAccount::PURPOSE_ASK))
            ->map(fn (AiAccount $account): array => [
                'id' => $account->id,
                'name' => $account->name,
                'vendor_key' => $account->vendor,
                'vendor' => AiAccount::VENDORS[$account->vendor] ?? $account->vendor,
                'model' => $account->model,
                'models' => collect($account->pickableModels())->map(fn (string $label, string $id): array => ['id' => $id, 'label' => $label])->values()->all(),
                // * Only API accounts have a cap we set; a CLI account runs under its own limits, unknown here.
                'max_output_tokens' => $account->auth_type === AiAccount::AUTH_API ? ApiLlmClient::MAX_OUTPUT_TOKENS : null,
                'status' => $account->status,
                'out_of_quota' => $this->outOfQuota($account, $resets[$account->id] ?? null),
            ])->values()->all();
    }

    /**
     * True while the account's last call stopped on its quota: until the reset time the limit error stated, else for an hour after that call.
     *
     * @param  string|null  $resetAt  the latest reset time any quota stop of this account stated
     */
    private function outOfQuota(AiAccount $account, ?string $resetAt): bool
    {
        if ($account->status !== 'error' || $account->last_error !== AiException::QUOTA) {
            return false;
        }

        return $resetAt !== null
            ? Carbon::parse($resetAt)->isFuture()
            : $account->last_checked_at !== null && $account->last_checked_at->gt(now()->subHour());
    }

    /** @return array{account_id: int, model: string|null}|null the account that answered, only when it is not the one picked */
    private function switchedTo(Request $request): ?array
    {
        $answered = $this->assistant->answeredBy();
        $picked = $request->input('ai_account_id');

        return $answered !== null && $picked !== null && (int) $picked !== $answered['account_id'] ? $answered : null;
    }

    /** * Internal id of the chat a new thread is a child session of: only the signed-in admin's own chat counts, and a child is never a parent (one level). */
    private function parentId(SendAiChatMessageRequest $request, Admin $user): ?int
    {
        $uuid = $request->validated('parent_conversation_id');

        return $uuid === null ? null : AiConversation::query()->ownedBy($user)->whereNull('parent_id')->where('uuid', $uuid)->value('id');
    }

    /** Saves the person's question (and the thread, when it is new) after the AI failed to answer it. */
    private function keepFailedTurn(Admin $user, ?AiConversation $conversation, string $project, string $stored, ?int $parentId = null): AiConversation
    {
        $conversation = DB::transaction(function () use ($user, $conversation, $project, $stored, $parentId): AiConversation {
            $conversation ??= AiConversation::query()->create(['user_id' => $user->id, 'parent_id' => $parentId, 'repo' => $project, 'title' => Str::limit(Str::squish($stored), AiConversation::TITLE_LENGTH, '…')]);

            if ($conversation->repo === null) {
                $conversation->update(['repo' => $project]);
            }

            $conversation->messages()->create(['role' => AiMessage::ROLE_USER, 'content' => $stored]);
            $conversation->touch();

            return $conversation;
        });

        Cache::forget(self::recentsCacheKey($user->id));

        return $conversation;
    }

    /** @return array{id: string, title: string, updated_at: string} `id` is the public uuid */
    private function conversationPayload(AiConversation $conversation): array
    {
        return ['id' => $conversation->uuid, 'title' => $conversation->title, 'repo' => $conversation->repo, 'updated_at' => $conversation->updated_at->toIso8601String()];
    }

    /** @return array{id: int, role: string, content: string, created_at: string, proposals: list<array<string, mixed>>} */
    private function messagePayload(AiMessage $message): array
    {
        return ['id' => $message->id, 'role' => $message->role, 'content' => $message->content, 'created_at' => $message->created_at->toIso8601String(), 'proposals' => $this->proposalsPayload($message)];
    }

    /** @return list<array{id: int, repo: string, path: string, action: string, diff: string|null, status: string, pull_url: string|null}> */
    private function proposalsPayload(AiMessage $message): array
    {
        return $message->proposals->map(fn (AiChangeProposal $proposal): array => [
            'id' => $proposal->id,
            // * The answer the edit belongs to: the code viewer's tick applies or drops that answer's edits.
            'message_id' => $proposal->ai_message_id,
            'repo' => $proposal->repo,
            'path' => $proposal->path,
            'action' => $proposal->action,
            'diff' => $proposal->diff,
            'content' => $proposal->content,
            'status' => $proposal->status,
            'pull_url' => $proposal->pull_url,
        ])->values()->all();
    }
}
