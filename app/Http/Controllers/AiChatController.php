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
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Ai\AiUsageStats;
use App\Services\Ai\ApiLlmClient;
use App\Services\Ai\ChatAttachmentReader;
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
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

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
        return Cache::remember(self::recentsCacheKey($user->id), self::RECENTS_CACHE_SECONDS, fn (): array => AiConversation::query()->ownedBy($user)->latest('updated_at')->latest('id')->limit(self::RECENTS)->get()
            ->map(fn (AiConversation $conversation): array => $this->conversationPayload($conversation))->all());
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
        $data = $request->validate(['repo' => ['required', 'string', 'max:140', 'regex:#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#']]);

        try {
            return response()->json($this->github->browse($data['repo']));
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
        ]);

        $mime = ImageFiles::mime($data['path']);

        try {
            if ($mime !== null) {
                $bytes = $this->github->readImage($data['repo'], $data['path']);

                return $bytes === null
                    ? response()->json(['message' => 'Không xem được ảnh này (quá lớn hoặc không đọc được, tối đa 1 MB).'], 422)
                    : response()->json(['path' => $data['path'], 'image' => ImageFiles::dataUrl($mime, $bytes)]);
            }

            $content = $this->github->readFile($data['repo'], $data['path']);
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
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json(['prompt' => $prompt]);
    }

    public function send(SendAiChatMessageRequest $request): JsonResponse
    {
        $user = $request->user();
        $text = trim($request->validated('message'));
        $conversationId = $request->validated('conversation_id');

        $conversation = $conversationId === null ? null : AiConversation::query()->ownedBy($user)->where('uuid', $conversationId)->firstOrFail();
        $history = $conversation === null ? [] : $this->history($conversation);

        // * Attached files and the repo go to the AI for this turn only; the thread keeps the text plus the names.
        $files = $request->file('attachments', []);
        $sections = [];
        $notes = [];

        foreach ($files as $file) {
            $content = $this->attachments->read($file);

            if ($content === null) {
                return response()->json(['message' => 'Không đọc được nội dung tệp "'.$file->getClientOriginalName().'".'], 422);
            }

            $sections[] = 'Tệp đính kèm: '.$file->getClientOriginalName()."\n".$content;
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

        try {
            if ($localRoot !== null) {
                $sections[] = $this->workspace->context($localRoot, $text);
                $notes[] = 'Local: '.$localRoot;
            }

            if ($repo !== null) {
                $sections[] = $this->github->context($repo, $text);
                $notes[] = 'GitHub: '.$repo;
            }

            // * More projects picked together are context only: edits are proposed against the first one.
            foreach ($extraRoots as $extraRoot) {
                $sections[] = $this->workspace->context($extraRoot, $text);
                $notes[] = 'Local: '.$extraRoot;
            }

            foreach ($extraRepos as $extraRepo) {
                $sections[] = $this->github->context($extraRepo, $text);
                $notes[] = 'GitHub: '.$extraRepo;
            }

            // * Only the skills, subagents and MCP servers switched on for the picked projects reach the AI; every other MCP server stays blocked.
            $picked = array_values(array_filter([$localRoot === null ? null : self::LOCAL_PREFIX.$localRoot, $repo, ...array_map(fn (string $root): string => self::LOCAL_PREFIX.$root, $extraRoots), ...$extraRepos]));
            $tools = $this->tools->forChat($user, $picked, ResourcePermission::allows($user, 'ai', 'local-read') && $this->workspace->refusal($request) === null, $text);
            app(McpPolicy::class)->allow($tools['mcp']);

            if ($tools['section'] !== null) {
                $sections[] = $tools['section'];
            }

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
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        $stored = $notes === [] ? $text : $text."\n\n".implode(' · ', $notes);

        // * Edits the AI proposed become pending proposals (diffed against the repo now); only the person's approval ever writes to GitHub.
        $proposals = [];

        if ($repo !== null) {
            ['text' => $answer, 'proposals' => $proposals] = $this->buildProposals($repo, $answer);
        } elseif ($localRoot !== null) {
            ['text' => $answer, 'proposals' => $proposals] = $this->buildLocalProposals($localRoot, $answer);
        }

        [$conversation, $userMessage, $assistantMessage] = DB::transaction(function () use ($user, $conversation, $text, $stored, $answer, $proposals, $repo): array {
            $conversation ??= AiConversation::query()->create(['user_id' => $user->id, 'repo' => $repo, 'title' => Str::limit(Str::squish($text), AiConversation::TITLE_LENGTH, '…')]);

            // * A general chat that turns to a repo joins that project from then on.
            if ($conversation->repo === null && $repo !== null) {
                $conversation->update(['repo' => $repo]);
            }

            $userMessage = $conversation->messages()->create(['role' => AiMessage::ROLE_USER, 'content' => $stored]);
            $assistantMessage = $conversation->messages()->create(['role' => AiMessage::ROLE_ASSISTANT, 'content' => $answer]);
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

        return response()->json([
            'conversation' => $this->conversationPayload($conversation),
            'user_message' => $this->messagePayload($userMessage),
            'assistant_message' => $this->messagePayload($assistantMessage->load('proposals')),
            'auto_pr_error' => $autoPrError,
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
                // * Check every file first so a conflict writes nothing.
                foreach ($pending as $proposal) {
                    if ($this->workspace->currentHash($this->rootOf($proposal), $proposal->path) !== $proposal->base_sha) {
                        throw new LocalWorkspaceException(LocalWorkspaceException::CONFLICT, 409);
                    }
                }

                foreach ($pending as $proposal) {
                    $root = $this->rootOf($proposal);
                    $hashes = $this->workspace->write($root, $proposal->path, $proposal->content, $proposal->base_sha);
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
            ])->values()->all();
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
