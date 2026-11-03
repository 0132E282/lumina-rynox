import { Head, router, usePage } from '@inertiajs/react';
import {
    Folder,
    Globe,
    Menu,
    PanelLeft,
    PanelRight,
    Plus,
    Terminal,
} from 'lucide-react';
import axios from 'axios';
import { postStream } from '@/lib/post-stream';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { optimize } from '@/actions/App/Http/Controllers/AiChatController';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ActivityTerminal } from '@/components/ai-chat/activity-terminal';
import { BrowserPane } from '@/components/ai-chat/browser-pane';
import type { ActivityEntry } from '@/components/ai-chat/activity-terminal';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import { AiUsageDialog } from '@/components/ai-chat/ai-usage-dialog';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import { ChatSettingsDialog } from '@/components/ai-chat/chat-settings-dialog';
import { ChatComposer } from '@/components/ai-chat/chat-composer';
import { CodeViewer } from '@/components/ai-chat/code-viewer';
import { ChatThread } from '@/components/ai-chat/chat-thread';
import type { ThreadItem } from '@/components/ai-chat/chat-thread';
import { FileViewer } from '@/components/ai-chat/file-viewer';
import { SidePanel } from '@/components/ai-chat/side-panel';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { SessionPanel } from '@/components/ai-chat/session-panel';
import { speakIfAuto, stopSpeaking } from '@/lib/speak';
import { markTyping } from '@/lib/typing';
import { expandReferences, referenceBlock } from '@/lib/code-reference';
import type { CodeReference } from '@/lib/code-reference';
import { SourceIcon } from '@/components/ai-chat/source-icon';
import {
    GithubBranchPopover,
    LocalBranchPopover,
} from '@/components/ai-chat/branch-popover';
import { RecentsList } from '@/components/ai-chat/recents-list';
import type { RecentsTab } from '@/components/ai-chat/recents-list';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { FileViewerContext } from '@/contexts/file-viewer-context';
import type { ViewerFile } from '@/lib/viewer-file';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { aiErrorMessage } from '@/lib/ai-error';
import { api } from '@/lib/api';
import {
    invalidateAiChatCache,
    readAiChatCache,
    setAiChatCacheScope,
    writeAiChatCache,
} from '@/lib/ai-chat-cache';
import { OPEN_CONVERSATION_VISIT, PENDING_CHAT_ID } from '@/lib/ai-chat-visit';
import { cn } from '@/lib/utils';
import { home } from '@/routes';
import type {
    Auth,
    AiChatAccount,
    AiChatActivityStep,
    AiAgentRun,
    AiPlanItem,
    AiSubagent,
    AiChatConversation,
    AiChatMessage,
    AiChatMode,
    AiChatPageProps,
    AiChatProposal,
    AiChatSelection,
    AiChatSettings,
    AiChatSendResponse,
} from '@/types';

// * Same cap as `SendAiChatMessageRequest::MAX_MESSAGE_LENGTH`.
const MAX_MESSAGE_LENGTH = 2000;

const MODE_KEY = 'ai-chat:mode';

// * Newest messages of an opened conversation kept in sessionStorage so reopening it shows them at once.
const CACHED_MESSAGES = 50;

/** * Name and avatar of the assistant: the person's choices, else the AI account's vendor. */
function assistantIdentity(
    settings: AiChatSettings,
    account: AiChatAccount | undefined,
): AssistantIdentity {
    return {
        imageUrl: settings.avatar_url,
        icon: settings.assistant_icon,
        color: settings.assistant_color,
        name: settings.assistant_name,
        vendor: account
            ? { key: account.vendor_key, name: account.vendor }
            : undefined,
    };
}

/** * Light placeholder while a conversation with no remembered messages loads, so the main area is never blank. */
function ThreadSkeleton() {
    return (
        <div
            role="status"
            aria-label="Đang tải cuộc trò chuyện"
            className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-4 pt-4"
        >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
                {[60, 85, 45].map((width, index) => (
                    <div
                        key={index}
                        className={cn(
                            'h-12 rounded-2xl bg-muted motion-safe:animate-pulse',
                            index % 2 === 0 && 'self-end',
                        )}
                        style={{ width: `${width}%` }}
                    />
                ))}
            </div>
        </div>
    );
}

type SessionState = { items: ThreadItem[] };

// * The side panel starts closed on every load; this keeps it as the person left it while they open other chats (the page remounts), not across a reload.
let infoStaysOpen = false;
const RECENTS_TAB_KEY = 'ai-chat.recents-tab';

// * Same limits as `SendAiChatMessageRequest` / `ChatAttachmentReader::extensions()`.
const MAX_ATTACHMENTS = 5;
const ATTACHMENT_EXTENSIONS = [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'pdf',
    'docx',
    'txt',
    'md',
    'php',
    'js',
    'jsx',
    'ts',
    'tsx',
    'vue',
    'json',
    'csv',
    'yml',
    'yaml',
    'toml',
    'ini',
    'css',
    'scss',
    'html',
    'sql',
    'sh',
    'py',
    'rb',
    'go',
    'rs',
    'java',
    'kt',
    'swift',
    'c',
    'h',
    'cpp',
    'cs',
    'xml',
    'log',
];

const AUTO_PR_KEY = 'ai-chat.auto-pr';

function ChatPanel({
    conversation,
    initialMessages,
    aiAccounts,
    githubConnected,
    showProjects,
    repo,
    onRepoChange,
    agents,
    onAgentStart,
    onAgentStep,
    onAgentEnd,
    extraRepos,
    onExtraReposChange: setExtraRepos,
    onLog,
    onChanges,
    proposalSync,
    onOpenFile,
    onSession,
    selection,
    onSelectionChange,
    mode,
    onModeChange,
    settings,
    askRequest,
    activeFile,
    markedFiles,
    onPending,
    onConversationId,
}: {
    conversation: AiChatConversation | null;
    initialMessages: AiChatMessage[];
    aiAccounts: AiChatAccount[];
    githubConnected: boolean;
    /** * The project picker belongs to the Code tab only. */
    showProjects: boolean;
    repo: string | null;
    onRepoChange: (repo: string | null) => void;
    /** * Agents working right now across every chat of this page. */
    agents: AiAgentRun[];
    onAgentStart: (run: Omit<AiAgentRun, 'id' | 'startedAt'>) => number;
    onAgentStep: (id: number, step: string) => void;
    onAgentEnd: (id: number) => void;
    extraRepos: string[];
    onExtraReposChange: (extras: string[]) => void;
    /** * Adds a line to the read-only activity terminal. */
    onLog: (level: ActivityEntry['level'], text: string) => void;
    /** * The files the AI proposed to change in this conversation, for the code viewer. */
    onChanges: (proposals: AiChatProposal[]) => void;
    /** * Proposals the code viewer decided (applied, dropped, undone): the cards in this thread show the same state. */
    proposalSync: { id: number; updated: AiChatProposal[] } | null;
    /** * Opens a file of an edit proposal in the code viewer. */
    onOpenFile: (repo: string, path: string) => void;
    /** * The live thread and the picked AI account, for the read-only session panel. */
    onSession: (session: SessionState) => void;
    /** * AI account/model and answer mode, owned by the page so the chat-settings dialog shares them with this composer. */
    selection: AiChatSelection;
    onSelectionChange: (selection: AiChatSelection) => void;
    mode: AiChatMode;
    onModeChange: (mode: AiChatMode) => void;
    /** * The person's chat customisation (assistant name and avatar). */
    settings: AiChatSettings;
    /** * Lines picked in the code viewer: added to the draft once per request. */
    askRequest: { id: number; reference: CodeReference } | null;
    /** * The file open in the code viewer: tagged by itself, replaced when another file opens. */
    activeFile: string | null;
    /** * Files picked together in the viewer (Cmd/Ctrl+click): all tagged, instead of the open file alone. */
    markedFiles: string[];
    /** * A first message of a project chat is on its way: the sidebar lists the chat under its project at once. */
    onPending: (chat: AiChatConversation | null) => void;
    /** * The id of the chat on screen (null until its first message is saved): the code viewer's comment box opens its sessions under it. */
    onConversationId: (id: string | null) => void;
}) {
    const authUser = usePage<{ auth: Auth }>().props.auth.user;
    const [items, setItems] = useState<ThreadItem[]>(initialMessages);
    const [draft, setDraft] = useState('');
    // * Code picked in the viewer: shown as tags (file and lines) and sent with the next message.
    const [references, setReferences] = useState<CodeReference[]>([]);
    // * What the app is doing for the message being answered, step by step as the server reports it.
    const [liveSteps, setLiveSteps] = useState<AiChatActivityStep[]>([]);
    // * Subagents the AI started for the answer being waited for (kept after it ends, cleared by the next send).
    const [plan, setPlan] = useState<AiPlanItem[]>([]);
    const [subagents, setSubagents] = useState<AiSubagent[]>([]);
    // * A request that was there before this chat mounted is already handled.
    const handledAsk = useRef<number | null>(askRequest?.id ?? null);

    // * The file being viewed is tagged by itself (or all the files picked with Cmd/Ctrl+click); opening another swaps the tags, and a tag the person removed stays gone until then.
    useEffect(() => {
        const paths =
            markedFiles.length > 0
                ? markedFiles
                : activeFile === null
                  ? []
                  : [activeFile];

        setReferences((current) => [
            ...current.filter((reference) => reference.auto !== true),
            ...paths.map((path) => ({
                path,
                startLine: 0,
                endLine: 0,
                text: path,
                auto: true,
            })),
        ]);
    }, [activeFile, markedFiles]);

    useEffect(() => {
        if (askRequest !== null && handledAsk.current !== askRequest.id) {
            handledAsk.current = askRequest.id;
            setReferences((current) => [...current, askRequest.reference]);
        }
    }, [askRequest]);
    const [sending, setSending] = useState(false);
    // * Messages written while an answer is still coming: sent one by one, each after the previous answer.
    const [queue, setQueue] = useState<
        { id: string; text: string; files: File[] }[]
    >([]);
    // * Stops the answer being waited for (the stop button).
    const sendAbort = useRef<AbortController | null>(null);
    // * A send keeps running when the person opens another chat: its answer is saved on the server, so it must not pull them back here.
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
        };
    }, []);
    const [files, setFiles] = useState<File[]>([]);
    const [optimizing, setOptimizing] = useState(false);
    // * "Tự tạo Pull Request" (default on): AI edits go straight to a new branch + PR; the base branch is never written.
    const [autoPr, setAutoPr] = useState(() => {
        try {
            return localStorage.getItem(AUTO_PR_KEY) !== '0';
        } catch {
            return true;
        }
    });
    // * The draft as it was before "Tối ưu", so the rewrite can be undone.
    const [previousDraft, setPreviousDraft] = useState<string | null>(null);
    useEffect(() => {
        onChanges(items.flatMap((item) => item.proposals ?? []));
    }, [items, onChanges]);

    // * A decision made in the code viewer reaches the cards of the thread (no stale "Hoàn tác" button).
    useEffect(() => {
        if (proposalSync === null) {
            return;
        }

        setItems((current) =>
            current.map((item) =>
                item.proposals?.some((proposal) =>
                    proposalSync.updated.some(
                        (update) => update.id === proposal.id,
                    ),
                )
                    ? {
                          ...item,
                          proposals: item.proposals.map(
                              (proposal) =>
                                  proposalSync.updated.find(
                                      (update) => update.id === proposal.id,
                                  ) ?? proposal,
                          ),
                      }
                    : item,
            ),
        );
    }, [proposalSync]);

    useEffect(() => {
        onSession({ items });
    }, [items, onSession]);

    const conversationId = useRef<string | null>(conversation?.id ?? null);

    useEffect(
        () => onConversationId(conversationId.current),
        [onConversationId],
    );
    const nextLocalId = useRef(0);

    /** `chosen`: text of a picked ```choices option, sent as-is; the draft and attachments stay untouched. */
    const answering = aiAccounts.find(
        (account) => account.id === selection.accountId,
    );
    const assistant = assistantIdentity(settings, answering);

    const submit = async (chosen?: string, queuedFiles: File[] = []) => {
        const text = (chosen ?? expandReferences(draft, references)).trim();

        // * The tag of the open file alone is not a message: something has to be typed or picked as well.
        if (
            text === '' ||
            (chosen === undefined &&
                draft.trim() === '' &&
                references.every((reference) => reference.auto === true))
        ) {
            return;
        }

        // * Still answering: the message waits its turn and goes out when the answer is done.
        if (sending) {
            setQueue((current) => [
                ...current,
                {
                    id: `queued-${nextLocalId.current++}`,
                    text,
                    files: chosen === undefined ? files : queuedFiles,
                },
            ]);

            if (chosen === undefined) {
                setDraft('');
                setReferences((current) =>
                    current.filter((reference) => reference.auto === true),
                );
                setPreviousDraft(null);
                setFiles([]);
            }

            return;
        }

        const localId = `local-${nextLocalId.current++}`;

        const sentFiles = chosen === undefined ? files : queuedFiles;

        if (chosen === undefined) {
            setDraft('');
            setReferences((current) =>
                current.filter((reference) => reference.auto === true),
            );
            setPreviousDraft(null);
            setFiles([]);
        }

        stopSpeaking();
        setSending(true);
        const agentId = onAgentStart({
            name:
                aiAccounts.find((item) => item.id === selection.accountId)
                    ?.name ?? 'AI mặc định',
            step: 'Đang gửi yêu cầu',
            task: text.slice(0, 60),
            conversationId: conversationId.current ?? PENDING_CHAT_ID,
        });
        setItems((current) => [
            ...current.filter((item) => item.role !== 'error'),
            {
                id: localId,
                role: 'user',
                content: text,
            },
        ]);

        if (conversationId.current === null && repo !== null) {
            onPending({
                id: PENDING_CHAT_ID,
                title: text.slice(0, 80),
                repo,
                updated_at: new Date().toISOString(),
            });
        }

        try {
            const form = new FormData();

            form.append('message', text);

            if (conversationId.current !== null) {
                form.append('conversation_id', conversationId.current);
            }

            if (selection.accountId !== null) {
                form.append('ai_account_id', String(selection.accountId));
            }

            if (selection.model !== null) {
                form.append('ai_model', selection.model);
            }

            if (mode !== 'auto') {
                form.append('mode', mode);
            }

            // * Projects picked together with the main one: ids only, read as context.
            (repo === null ? [] : extraRepos).forEach((extra) =>
                form.append(
                    extra.startsWith('local:')
                        ? 'extra_local_roots[]'
                        : 'extra_repos[]',
                    extra.startsWith('local:') ? extra.slice(6) : extra,
                ),
            );

            if (repo !== null && repo.startsWith('local:')) {
                // * A folder of this machine: the client names a root id only, never a path.
                form.append('local_root', repo.slice(6));
            } else if (repo !== null) {
                form.append('repo', repo);
                form.append('auto_pr', autoPr ? '1' : '0');
            }

            sentFiles.forEach((file) => form.append('attachments[]', file));

            const account = aiAccounts.find(
                (item) => item.id === selection.accountId,
            );

            onLog(
                'info',
                `Gửi tin nhắn · ${account?.name ?? 'AI mặc định'}${selection.model ? ` · ${selection.model}` : ''}${repo ? ` · repo ${repo}` : ''}${sentFiles.length > 0 ? ` · ${sentFiles.length} tệp` : ''}`,
            );

            onAgentStep(agentId, 'Đang đọc ngữ cảnh và trả lời');

            const controller = new AbortController();

            sendAbort.current = controller;

            setLiveSteps([]);
            setSubagents([]);
            setPlan([]);

            const data = await postStream<AiChatSendResponse>(
                '/ai-chat/messages/stream',
                form,
                {
                    signal: controller.signal,
                    onPlan: setPlan,
                    onAgent: (event) =>
                        setSubagents((current) => {
                            const known = current.some(
                                (agent) => agent.id === event.id,
                            );

                            if (!known) {
                                return [
                                    ...current,
                                    {
                                        parent: null,
                                        role: 'subagent',
                                        task: '',
                                        step: '',
                                        status: 'running',
                                        ...event,
                                        startedAt: Date.now(),
                                        endedAt: null,
                                    },
                                ];
                            }

                            return current.map((agent) =>
                                agent.id === event.id
                                    ? {
                                          ...agent,
                                          ...event,
                                          endedAt:
                                              event.status === 'done'
                                                  ? Date.now()
                                                  : agent.endedAt,
                                      }
                                    : agent,
                            );
                        }),
                    onStep: (step) => {
                        setLiveSteps((current) => [...current, step]);
                        onAgentStep(
                            agentId,
                            step.kind === 'ask'
                                ? 'Đang chờ AI trả lời'
                                : `Đang đọc ${step.detail || step.source}`,
                        );
                    },
                },
            );

            onAgentStep(agentId, 'Đang xử lý câu trả lời');

            const proposals = data.assistant_message.proposals ?? [];
            const pull = proposals.find((proposal) => proposal.pull_url);

            onLog('ok', 'AI đã trả lời.');

            // * The picked AI hit its quota and another one answered: the picker follows it.
            if (data.answered_by) {
                const switched = aiAccounts.find(
                    (item) => item.id === data.answered_by?.account_id,
                );

                onSelectionChange({
                    accountId: data.answered_by.account_id,
                    model: data.answered_by.model,
                });
                onLog(
                    'info',
                    `AI đã chọn hết hạn mức, tự chuyển sang ${switched?.name ?? 'AI khác'}.`,
                );
            }
            // * A call was just made: the usage stats are out of date.
            invalidateAiChatCache('usage');

            if (proposals.length > 0) {
                onLog('info', `AI đề xuất sửa ${proposals.length} tệp.`);
            }

            if (pull?.pull_url) {
                onLog('ok', `Đã tạo Pull Request: ${pull.pull_url}`);
            }

            if (data.auto_pr_error) {
                onLog(
                    'error',
                    `Tạo Pull Request tự động lỗi: ${data.auto_pr_error}`,
                );
            }

            const isNew = conversationId.current === null;

            // * The answer appears as if typed (only when it has no edit cards to wait for).
            if ((data.assistant_message.proposals ?? []).length === 0) {
                markTyping(data.assistant_message.id);
            }

            speakIfAuto(
                data.assistant_message.id,
                data.assistant_message.content,
            );
            conversationId.current = data.conversation.id;
            onConversationId(data.conversation.id);
            setItems((current) => [
                ...current.filter((item) => item.id !== localId),
                data.user_message,
                { ...data.assistant_message, steps: data.activity ?? [] },
                ...(data.auto_pr_error
                    ? [
                          {
                              id: `error-pr-${localId}`,
                              role: 'error' as const,
                              content: `Chưa tạo được Pull Request tự động: ${data.auto_pr_error} Bạn vẫn có thể duyệt thủ công bên dưới.`,
                          },
                      ]
                    : []),
            ]);

            // * The first answer creates the conversation: put its id in the URL (a reload keeps the thread) and refresh Recents.
            if (isNew && mounted.current) {
                router.get(
                    home.url({ query: { c: data.conversation.id } }),
                    {},
                    {
                        only: [
                            'conversations',
                            'activeConversation',
                            'messages',
                        ],
                        preserveState: true,
                        preserveScroll: true,
                        replace: true,
                    },
                );
            } else {
                router.reload({ only: ['conversations'] });
            }
        } catch (caught) {
            if (mounted.current) {
                onPending(null);
            }

            if (axios.isCancel(caught)) {
                onLog('info', 'Đã dừng câu trả lời.');
                setItems((current) => [
                    ...current,
                    {
                        id: `error-${localId}`,
                        role: 'error',
                        content:
                            'Đã dừng câu trả lời. Bạn có thể gửi lại hoặc hỏi tiếp.',
                    },
                ]);
                setFiles(sentFiles);

                return;
            }

            // * The server keeps the question of a coding chat even when the answer failed: the thread goes on from there and shows in the project's list.
            const kept = (
                caught as {
                    response?: { data?: { conversation?: { id: string } } };
                }
            ).response?.data?.conversation?.id;

            if (kept && mounted.current) {
                conversationId.current = kept;
                onConversationId(kept);
                router.reload({ only: ['conversations'] });
            }

            if (!axios.isAxiosError(caught)) {
                // * Not a server answer (a script error or a dropped connection): the page's own error text hides it, so the console keeps it.
                console.error('ai-chat send failed', caught);
            }

            onLog('error', `Gửi tin nhắn lỗi: ${aiErrorMessage(caught)}`);
            // * A failed send keeps the attached files so the person can try again.
            setFiles(sentFiles);
            setItems((current) => [
                ...current,
                {
                    id: `error-${localId}`,
                    role: 'error',
                    content: aiErrorMessage(caught),
                },
            ]);
        } finally {
            sendAbort.current = null;
            setLiveSteps([]);
            setSending(false);
            onAgentEnd(agentId);
        }
    };

    useEffect(() => {
        if (!sending && queue.length > 0) {
            const [next, ...rest] = queue;

            setQueue(rest);
            void submit(next.text, next.files);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sending, queue]);

    const optimizeDraft = async () => {
        const text = draft.trim();

        if (text === '' || optimizing || sending) {
            return;
        }

        setOptimizing(true);
        onLog('info', 'Tối ưu prompt...');

        try {
            const { data } = await api.post<{ prompt: string }>(
                optimize.url(),
                {
                    message: text,
                    ai_account_id: selection.accountId,
                    ai_model: selection.model,
                },
            );

            setPreviousDraft(draft);
            setDraft(data.prompt);
            onLog('ok', 'Đã viết lại prompt.');
        } catch (caught) {
            onLog('error', `Tối ưu prompt lỗi: ${aiErrorMessage(caught)}`);
            setItems((current) => [
                ...current.filter((item) => item.role !== 'error'),
                {
                    id: `error-optimize-${nextLocalId.current++}`,
                    role: 'error',
                    content: aiErrorMessage(caught),
                },
            ]);
        } finally {
            setOptimizing(false);
        }
    };

    const composer = (
        <>
            <ChatComposer
                value={draft}
                onChange={setDraft}
                references={references}
                onReferencesChange={setReferences}
                onSubmit={() => void submit()}
                queued={queue}
                onRemoveQueued={(id) =>
                    setQueue((current) =>
                        current.filter((item) => item.id !== id),
                    )
                }
                onStop={() => {
                    sendAbort.current?.abort();
                    stopSpeaking();
                }}
                sending={sending}
                agents={agents}
                subagents={subagents}
                proposals={items.flatMap((item) => item.proposals ?? [])}
                onSendMessage={(text) => void submit(text)}
                plan={plan}
                maxLength={MAX_MESSAGE_LENGTH}
                autoFocus
                accounts={aiAccounts}
                selection={selection}
                onSelectionChange={onSelectionChange}
                files={files}
                onFilesChange={setFiles}
                acceptedExtensions={ATTACHMENT_EXTENSIONS}
                maxFiles={MAX_ATTACHMENTS}
                repo={repo}
                onRepoChange={onRepoChange}
                extraRepos={extraRepos}
                onExtraReposChange={setExtraRepos}
                githubConnected={githubConnected}
                showProjects={showProjects}
                mode={mode}
                onModeChange={onModeChange}
                autoPr={autoPr}
                onAutoPrChange={(value) => {
                    setAutoPr(value);

                    try {
                        localStorage.setItem(AUTO_PR_KEY, value ? '1' : '0');
                    } catch {
                        // * Storage can be blocked; the switch still works for this visit.
                    }
                }}
                focusSignal={askRequest?.id}
                onUndoOptimize={
                    previousDraft === null
                        ? undefined
                        : () => {
                              setDraft(previousDraft);
                              setPreviousDraft(null);
                          }
                }
                onOptimize={() => void optimizeDraft()}
                optimizing={optimizing}
            />
        </>
    );

    if (items.length === 0) {
        return (
            <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
                        {/* * The character the person set up (avatar + name, see "Cài đặt nhân vật") introduces itself. */}
                        <AssistantAvatar
                            {...assistant}
                            className="size-20 rounded-full text-2xl"
                        />
                        <h1 className="text-center text-2xl font-semibold">
                            Hi {authUser.name}, hôm nay bạn muốn làm gì?
                        </h1>
                        <p className="max-w-md text-center text-sm text-muted-foreground">
                            {assistant.name
                                ? `Mình là ${assistant.name}, trợ lý AI của bạn.`
                                : 'Mình là trợ lý AI của bạn.'}{' '}
                            Mình có thể trả lời, soạn nội dung, đọc tệp và repo
                            GitHub.
                        </p>
                    </div>
                    <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
                        {composer}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ChatThread
                    items={items}
                    pending={sending}
                    liveSteps={liveSteps}
                    assistant={assistant}
                    onChoose={(text) => void submit(text)}
                    onRetry={() => {
                        // * Asks the last question again: the failed question and its error line go, submit puts the question back.
                        const question = [...items]
                            .reverse()
                            .find((item) => item.role === 'user');

                        if (question === undefined) {
                            return;
                        }

                        setItems((current) => {
                            const lastUser = current.findLastIndex(
                                (item) => item.role === 'user',
                            );

                            return lastUser === -1
                                ? current
                                : current.slice(0, lastUser);
                        });
                        void submit(question.content);
                    }}
                    onOpenFile={onOpenFile}
                    onProposalsChange={(id, proposals) =>
                        setItems((current) =>
                            current.map((item) =>
                                item.id === id ? { ...item, proposals } : item,
                            ),
                        )
                    }
                />
                <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    {composer}
                </div>
            </div>
        </div>
    );
}

const CHAT_MIN_WIDTH = 352;
export default function AiChatIndex({
    conversations,
    activeConversation,
    messages,
    aiAccounts,
    githubConnected,
    chatContext,
    integrations,
    settings: savedSettings,
    aiAccountList,
}: AiChatPageProps) {
    const authUser = usePage<{ auth: Auth }>().props.auth.user;
    const userId = authUser.id;
    // * Memory caches (usage stats, local roots, GitHub data) belong to this person only.
    setAiChatCacheScope(userId);
    const [session, setSession] = useState<SessionState>({
        items: messages,
    });
    // * Account/model and answer mode live here so the composer and the chat-settings dialog share one state.
    const selectionKey = `ai-chat.selection.${userId}`;
    const [selection, setSelection] = useState<AiChatSelection>(() => {
        // * The account and model the person picked last time, while that account still exists.
        try {
            const saved = JSON.parse(
                localStorage.getItem(selectionKey) ?? 'null',
            ) as AiChatSelection | null;

            if (
                saved !== null &&
                aiAccounts.some((account) => account.id === saved.accountId)
            ) {
                return {
                    accountId: saved.accountId,
                    model: typeof saved.model === 'string' ? saved.model : null,
                };
            }
        } catch {
            // * Storage can be blocked or hold something else: fall through to the default.
        }

        // * The account chosen for the chat purpose (Cài đặt chat) first, else the first connected one.
        const first =
            aiAccounts.find(
                (account) =>
                    account.id ===
                    aiAccountList.purpose_accounts.ask?.[0]?.account_id,
            ) ??
            aiAccounts.find((account) => account.status === 'connected') ??
            aiAccounts[0];

        return { accountId: first?.id ?? null, model: first?.model ?? null };
    });
    useEffect(() => {
        try {
            localStorage.setItem(selectionKey, JSON.stringify(selection));
        } catch {
            // * Storage can be blocked; the pick still applies for this visit.
        }
    }, [selection, selectionKey]);
    // * An account switched off in the dialog can no longer answer: fall back to the first one that still can.
    useEffect(() => {
        if (
            selection.accountId !== null &&
            !aiAccounts.some((account) => account.id === selection.accountId)
        ) {
            const next = aiAccounts[0];

            setSelection({
                accountId: next?.id ?? null,
                model: next?.model ?? null,
            });
        }
    }, [aiAccounts, selection.accountId]);
    const [mode, setMode] = useState<AiChatMode>(() => {
        try {
            return localStorage.getItem(MODE_KEY) === 'plan' ? 'plan' : 'auto';
        } catch {
            return 'auto';
        }
    });
    const changeMode = (value: AiChatMode) => {
        setMode(value);

        try {
            localStorage.setItem(MODE_KEY, value);
        } catch {
            // * Storage can be blocked; the mode still applies for this visit.
        }
    };
    const [settings, setSettings] = useState<AiChatSettings>(savedSettings);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [statsOpen, setStatsOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(infoStaysOpen);
    const [wide, setWide] = useState(
        () => window.matchMedia('(min-width: 1024px)').matches,
    );
    const infoWidth = useResizableWidth('ai-chat.width.info', 288, 220, 480);
    // * Viewer width: about 45% of the screen by default, 360px at least and 70% at most (the saved width wins).
    const viewerBounds = useMemo(() => {
        const max = Math.max(480, window.innerWidth);

        return {
            max,
            initial: Math.min(
                max,
                Math.max(360, Math.round(window.innerWidth * 0.45)),
            ),
        };
    }, []);
    const viewerWidth = useResizableWidth(
        'ai-chat.width.viewer',
        viewerBounds.initial,
        360,
        viewerBounds.max,
    );
    // * The file open in the right-hand viewer (memory only); it takes the info panel's slot while open.
    const [viewerFile, setViewerFile] = useState<ViewerFile | null>(null);
    const [viewerClosing, setViewerClosing] = useState(false);
    const [viewerExpanded, setViewerExpanded] = useState(false);
    const [viewerDragging, setViewerDragging] = useState(false);
    const [infoDragging, setInfoDragging] = useState(false);
    const viewerPanel = useRef<HTMLElement>(null);
    const viewerOpener = useRef<HTMLElement | null>(null);
    const closeTimer = useRef<number | undefined>(undefined);
    const openViewer = useCallback((file: ViewerFile) => {
        window.clearTimeout(closeTimer.current);
        viewerOpener.current ??=
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        setViewerClosing(false);
        setViewerFile(file);
    }, []);
    // * Slides out for 200ms, then unmounts; with reduced motion it closes at once. Focus goes back to what opened it.
    const closeViewer = useCallback(() => {
        const finish = () => {
            setViewerFile(null);
            setViewerClosing(false);
            viewerOpener.current?.focus();
            viewerOpener.current = null;
        };

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            finish();

            return;
        }

        setViewerClosing(true);
        closeTimer.current = window.setTimeout(finish, 200);
    }, []);
    const viewerApi = useMemo(() => ({ open: openViewer }), [openViewer]);

    useEffect(() => () => window.clearTimeout(closeTimer.current), []);
    useEffect(() => {
        if (viewerFile && !viewerClosing) {
            viewerPanel.current?.focus();
        }
    }, [viewerFile, viewerClosing]);

    useEffect(() => {
        const query = window.matchMedia('(min-width: 1024px)');
        const update = () => setWide(query.matches);

        query.addEventListener('change', update);

        return () => query.removeEventListener('change', update);
    }, []);

    const toggleInfo = () =>
        setInfoOpen((open) => {
            infoStaysOpen = !open;

            return !open;
        });
    const [recentsOpen, setRecentsOpen] = useState(false);
    const [recentsCollapsed, setRecentsCollapsed] = useState(false);
    const activeId = activeConversation?.id ?? null;
    // * The Terminal belongs to the "Code" tab: other tabs only hide it (its open state and log are kept).
    // * The tab is kept for the visit (sessionStorage): opening a chat remounts the page and must not switch the sidebar to the other tab.
    const [recentsTab, setRecentsTabState] = useState<RecentsTab>(() => {
        try {
            return sessionStorage.getItem(RECENTS_TAB_KEY) === 'projects'
                ? 'projects'
                : 'chat';
        } catch {
            return 'chat';
        }
    });
    const setRecentsTab = useCallback((tab: RecentsTab) => {
        setRecentsTabState(tab);

        try {
            sessionStorage.setItem(RECENTS_TAB_KEY, tab);
        } catch {
            // * Storage blocked: the tab still applies for this page.
        }
    }, []);
    // * The repo and its code viewer belong to the page. Only the Code tab has a repo: in the Chat tab no repo is sent, even if one was picked earlier.
    const [selectedRepo, setRepo] = useState<string | null>(null);
    // * Further projects picked together with the main one; they belong to the page so a pick from the sidebar can set them.
    const [extraRepos, setExtraRepos] = useState<string[]>([]);
    // * Which of the picked projects the code viewer shows (the main one unless the person switched).
    const [viewedRepo, setViewedRepo] = useState<string | null>(null);
    // * GitHub branch the code viewer shows; null is the default branch. A new project starts back on its default.
    const [viewedBranch, setViewedBranch] = useState<string | null>(null);
    const selectedRepoRef = useRef(selectedRepo);

    selectedRepoRef.current = selectedRepo;
    const repo = recentsTab === 'projects' ? selectedRepo : null;
    const viewed =
        repo !== null && viewedRepo !== null && extraRepos.includes(viewedRepo)
            ? viewedRepo
            : repo;
    const [codeOpen, setCodeOpen] = useState(false);

    useEffect(() => {
        setViewedBranch(null);
    }, [viewed]);
    // * A file the person clicked in an edit proposal: the code viewer opens it (the id makes the same file open again).
    // * The chat being created for a project, shown in the sidebar until the saved list arrives.
    const [pendingChat, setPendingChat] = useState<AiChatConversation | null>(
        null,
    );

    useEffect(() => {
        setPendingChat(null);
    }, [conversations]);

    const listedConversations = useMemo(
        () =>
            pendingChat === null
                ? conversations
                : [pendingChat, ...conversations],
        [pendingChat, conversations],
    );
    const [askRequest, setAskRequest] = useState<{
        id: number;
        reference: CodeReference;
    } | null>(null);
    const [openRequest, setOpenRequest] = useState<{
        repo: string;
        path: string;
        id: number;
    } | null>(null);
    const [changes, setChanges] = useState<AiChatProposal[]>([]);
    const [proposalSync, setProposalSync] = useState<{
        id: number;
        updated: AiChatProposal[];
    } | null>(null);
    const [activeFile, setActiveFile] = useState<string | null>(null);
    // * The chat on screen, for the sessions the code viewer's comment box opens under it.
    const [liveChatId, setLiveChatId] = useState<string | null>(null);
    const [markedFiles, setMarkedFiles] = useState<string[]>([]);
    const [terminalOpen, setTerminalOpen] = useState(false);
    const terminalWidth = useResizableWidth(
        'ai-chat.width.terminal',
        360,
        260,
        window.innerWidth,
    );
    const [terminalDragging, setTerminalDragging] = useState(false);
    const [browserOpen, setBrowserOpen] = useState(false);
    const browserWidth = useResizableWidth(
        'ai-chat.width.browser',
        420,
        300,
        window.innerWidth,
    );
    const [browserDragging, setBrowserDragging] = useState(false);
    const terminalVisible = recentsTab === 'projects';
    const [agents, setAgents] = useState<AiAgentRun[]>([]);
    const nextAgentId = useRef(0);
    const startAgent = useCallback(
        (run: Omit<AiAgentRun, 'id' | 'startedAt'>) => {
            const id = ++nextAgentId.current;

            setAgents((current) => [
                ...current,
                { ...run, id, startedAt: Date.now() },
            ]);

            return id;
        },
        [],
    );
    const stepAgent = useCallback(
        (id: number, step: string) =>
            setAgents((current) =>
                current.map((agent) =>
                    agent.id === id ? { ...agent, step } : agent,
                ),
            ),
        [],
    );
    const endAgent = useCallback(
        (id: number) =>
            setAgents((current) => current.filter((agent) => agent.id !== id)),
        [],
    );
    const runningIds = useMemo(
        () => new Set(agents.map((agent) => agent.conversationId)),
        [agents],
    );
    const [log, setLog] = useState<ActivityEntry[]>([]);
    const branchPopover =
        viewed === null ? null : viewed.startsWith('local:') ? (
            <LocalBranchPopover root={viewed.slice(6)} />
        ) : (
            <GithubBranchPopover
                repo={viewed}
                branch={viewedBranch}
                onSelectBranch={setViewedBranch}
            />
        );
    const nextLogId = useRef(0);
    const addLog = useCallback(
        (level: ActivityEntry['level'], text: string) =>
            setLog((current) =>
                [
                    ...current,
                    {
                        id: nextLogId.current++,
                        time: new Date().toLocaleTimeString('vi-VN'),
                        level,
                        text,
                    },
                ].slice(-200),
            ),
        [],
    );
    const terminalRoot = (viewed ?? repo)?.startsWith('local:')
        ? (viewed ?? repo)!.slice(6)
        : null;
    const runCommand = useMemo(
        () =>
            terminalRoot === null
                ? null
                : async (command: string) => {
                      addLog('info', `$ ${command}`);

                      try {
                          const { data } = await api.post<{
                              output: string;
                              exit_code: number | null;
                              timed_out: boolean;
                          }>('/ai-chat/local/exec', {
                              root: terminalRoot,
                              command,
                          });

                          if (data.timed_out) {
                              addLog('error', 'Quá thời gian chờ (60 giây).');

                              return;
                          }

                          if (data.output !== '') {
                              addLog(
                                  data.exit_code === 0 ? 'ok' : 'error',
                                  data.output,
                              );
                          } else if (data.exit_code !== 0) {
                              addLog('error', `Thoát với mã ${data.exit_code}`);
                          }
                      } catch {
                          addLog('error', 'Không chạy được lệnh.');
                      }
                  },
        [terminalRoot, addLog],
    );
    const terminal = (
        <ActivityTerminal
            entries={log}
            onClear={() => setLog([])}
            onClose={() => setTerminalOpen(false)}
            onRun={runCommand}
        />
    );
    // * Stale-while-revalidate: remember the open conversation, and while another one loads from the server show its remembered messages.
    const [opening, setOpening] = useState<string | null>(null);

    useEffect(() => {
        if (activeId !== null) {
            writeAiChatCache(
                userId,
                `thread.${activeId}`,
                messages.slice(-CACHED_MESSAGES),
            );
        }
    }, [userId, activeId, messages]);

    useEffect(() => {
        const stopBefore = router.on('before', (event) => {
            const { url, method } = event.detail.visit;
            const target = new URL(String(url), window.location.origin);

            setOpening(
                method === 'get' && target.pathname === home.url()
                    ? target.searchParams.get('c')
                    : null,
            );
        });
        const stopFinish = router.on('finish', () => setOpening(null));

        return () => {
            stopBefore();
            stopFinish();
        };
    }, []);

    const cachedOpening = useMemo(() => {
        if (opening === null || opening === activeId) {
            return null;
        }

        return readAiChatCache<AiChatMessage[]>(userId, `thread.${opening}`);
    }, [userId, opening, activeId]);
    // * Opening a chat that belongs to a project brings that project's repo along.
    const activeRepo = activeConversation?.repo ?? null;

    useEffect(() => {
        if (activeRepo !== null) {
            // * A chat just created for the picked project keeps the extras; opening a chat of another project drops them.
            if (activeRepo !== selectedRepoRef.current) {
                setExtraRepos([]);
            }

            setRepo(activeRepo);
            setRecentsTab('projects');
        }
    }, [activeRepo, activeId, setRecentsTab]);

    const selectRepo = useCallback(
        (name: string, extras: string[] = []) => {
            setRepo(name);
            setExtraRepos(extras);
            setViewedRepo(null);
            setRecentsTab('projects');
            addLog('info', name);

            // * Picking a project starts a fresh chat for it. preserveState keeps this page mounted: Inertia remounts a page on a plain GET visit, which reset the sidebar to the Chat tab and dropped the repo.
            if (activeId !== null) {
                router.get(home.url(), {}, { ...OPEN_CONVERSATION_VISIT });
            }
        },
        [activeId, addLog, setRecentsTab],
    );
    // * Stable callbacks and props: the memoised sidebar re-renders only when its own data changes, not on every thread or panel update.
    const collapseRecents = useCallback(() => setRecentsCollapsed(true), []);
    // * Dragging a right panel wider squeezes the chat to its minimum first; then the chat list folds, and any further width covers the chat.
    const chatSection = useRef<HTMLElement>(null);

    useEffect(() => {
        const section = chatSection.current;

        if (section === null || recentsCollapsed) {
            return;
        }

        const observer = new ResizeObserver(() => {
            if (section.getBoundingClientRect().width <= CHAT_MIN_WIDTH) {
                setRecentsCollapsed(true);
            }
        });

        observer.observe(section);

        return () => observer.disconnect();
    }, [recentsCollapsed]);
    const closeRecentsSheet = useCallback(() => setRecentsOpen(false), []);
    const openSettings = useCallback(() => setSettingsOpen(true), []);
    const openStats = useCallback(() => setStatsOpen(true), []);
    const openSettingsFromSheet = useCallback(() => {
        setRecentsOpen(false);
        setSettingsOpen(true);
    }, []);
    const openStatsFromSheet = useCallback(() => {
        setRecentsOpen(false);
        setStatsOpen(true);
    }, []);
    const pickedAccount = aiAccounts.find(
        (account) => account.id === selection.accountId,
    );
    const sidebarAssistant = useMemo(
        () => assistantIdentity(settings, pickedAccount),
        [settings, pickedAccount],
    );
    const infoPanel = (
        <SessionPanel
            items={session.items}
            chatContext={chatContext}
            accountLabel={
                pickedAccount
                    ? `${pickedAccount.vendor} · ${pickedAccount.name}`
                    : null
            }
            repo={repo}
            integrations={integrations}
        />
    );
    return (
        <FileViewerContext.Provider value={viewerApi}>
            <Head title="Trợ lý AI" />
            <AiUsageDialog
                open={statsOpen}
                onOpenChange={setStatsOpen}
                selection={selection}
            />
            <ChatSettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                settings={settings}
                onSaved={setSettings}
                accountList={aiAccountList}
                accountName={authUser.name}
                aiAccounts={aiAccounts}
                selection={selection}
                onSelectionChange={setSelection}
                projects={selectedRepo === null ? [] : [selectedRepo]}
                vendor={
                    pickedAccount
                        ? {
                              key: pickedAccount.vendor_key,
                              name: pickedAccount.vendor,
                          }
                        : undefined
                }
            />
            <div className="flex min-h-0 flex-1">
                {/* * The width animates to 0 when collapsed; the content keeps its own width so it clips instead of reflowing. */}
                <aside
                    aria-label="Gần đây"
                    inert={recentsCollapsed}
                    className={cn(
                        'hidden min-h-0 shrink-0 flex-col overflow-hidden border-r transition-[width,border-color] duration-200 ease-out motion-reduce:transition-none lg:flex',
                        recentsCollapsed ? 'w-0 border-transparent' : 'w-72',
                    )}
                >
                    <div className="flex min-h-0 w-72 flex-1 flex-col">
                        <RecentsList
                            conversations={listedConversations}
                            runningIds={runningIds}
                            aiAccounts={aiAccounts}
                            assistant={sidebarAssistant}
                            account={pickedAccount}
                            activeId={activeId}
                            onCollapse={collapseRecents}
                            repo={repo}
                            onSelectRepo={selectRepo}
                            githubConnected={githubConnected}
                            tab={recentsTab}
                            onOpenSettings={openSettings}
                            onOpenStats={openStats}
                            onTabChange={setRecentsTab}
                        />
                    </div>
                </aside>

                <section
                    ref={chatSection}
                    aria-label="Trò chuyện với trợ lý AI"
                    className={cn(
                        '@container/chat relative flex min-h-0 flex-1 flex-col',
                        // * With the project files open the chat may shrink to nothing when they are dragged wide; what no longer fits is clipped.
                        codeOpen && repo !== null
                            ? 'min-w-0 overflow-hidden'
                            : recentsCollapsed
                              ? 'min-w-0'
                              : 'min-w-[22rem]',
                    )}
                >
                    <div
                        className={cn(
                            // * A real header bar (white, padded, bottom border) so the chat text never runs behind the buttons.
                            'relative z-10 flex h-12 shrink-0 items-center border-b bg-background px-2',
                        )}
                    >
                        {recentsCollapsed && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Mở rộng danh sách"
                                onClick={() => setRecentsCollapsed(false)}
                                className="hidden lg:inline-flex"
                            >
                                <PanelLeft aria-hidden="true" />
                            </Button>
                        )}
                        <Sheet open={recentsOpen} onOpenChange={setRecentsOpen}>
                            <SheetTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Mở danh sách gần đây"
                                    className="lg:hidden"
                                >
                                    <Menu aria-hidden="true" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="w-72 p-0">
                                <SheetTitle className="sr-only">
                                    Gần đây
                                </SheetTitle>
                                <SheetDescription className="sr-only">
                                    Các cuộc trò chuyện gần đây với trợ lý AI.
                                </SheetDescription>
                                <RecentsList
                                    conversations={listedConversations}
                                    runningIds={runningIds}
                                    aiAccounts={aiAccounts}
                                    assistant={sidebarAssistant}
                                    account={pickedAccount}
                                    activeId={activeId}
                                    onNavigate={closeRecentsSheet}
                                    repo={repo}
                                    onSelectRepo={selectRepo}
                                    githubConnected={githubConnected}
                                    tab={recentsTab}
                                    onOpenSettings={openSettingsFromSheet}
                                    onOpenStats={openStatsFromSheet}
                                    onTabChange={setRecentsTab}
                                />
                            </SheetContent>
                        </Sheet>
                        <div className="ml-auto flex items-center gap-1">
                            {/* * A narrow chat folds these buttons into one menu. */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Công cụ"
                                        className="invisible w-0 overflow-hidden px-0 text-muted-foreground opacity-0 transition-[width,opacity] duration-200 motion-reduce:transition-none @max-sm/chat:visible @max-sm/chat:w-8 @max-sm/chat:opacity-100"
                                    >
                                        <Plus aria-hidden="true" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={toggleInfo}>
                                        <PanelRight aria-hidden="true" />
                                        Thông tin phiên chat
                                    </DropdownMenuItem>
                                    {terminalVisible && (
                                        <DropdownMenuItem
                                            onSelect={() =>
                                                setBrowserOpen((open) => !open)
                                            }
                                        >
                                            <Globe aria-hidden="true" />
                                            Trình duyệt
                                        </DropdownMenuItem>
                                    )}
                                    {terminalVisible && (
                                        <DropdownMenuItem
                                            onSelect={() =>
                                                setTerminalOpen((open) => !open)
                                            }
                                        >
                                            <Terminal aria-hidden="true" />
                                            Terminal
                                        </DropdownMenuItem>
                                    )}
                                    {repo !== null &&
                                        !repo.startsWith('local:') && (
                                            <DropdownMenuItem asChild>
                                                <a
                                                    href={`https://github.com/${repo}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    <SourceIcon local={false} />
                                                    Mở trên GitHub
                                                </a>
                                            </DropdownMenuItem>
                                        )}
                                    {repo !== null && (
                                        <DropdownMenuItem
                                            onSelect={() =>
                                                setCodeOpen((open) => !open)
                                            }
                                        >
                                            <Folder aria-hidden="true" />
                                            Mã nguồn repo
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Thông tin phiên chat"
                                aria-pressed={infoOpen}
                                title="Thông tin phiên chat"
                                onClick={toggleInfo}
                                className={cn(
                                    'size-8 overflow-hidden text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-sm/chat:invisible @max-sm/chat:w-0 @max-sm/chat:px-0 @max-sm/chat:opacity-0',
                                    infoOpen &&
                                        'bg-accent text-accent-foreground',
                                )}
                            >
                                <PanelRight aria-hidden="true" />
                            </Button>
                            {terminalVisible && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Trình duyệt"
                                    aria-pressed={browserOpen}
                                    title="Trình duyệt (xem dự án đang chạy trên máy)"
                                    onClick={() =>
                                        setBrowserOpen((open) => !open)
                                    }
                                    className={cn(
                                        'size-8 overflow-hidden text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-sm/chat:invisible @max-sm/chat:w-0 @max-sm/chat:px-0 @max-sm/chat:opacity-0',
                                        browserOpen &&
                                            'bg-accent text-accent-foreground',
                                    )}
                                >
                                    <Globe aria-hidden="true" />
                                </Button>
                            )}
                            {terminalVisible &&
                                !(codeOpen && repo !== null) && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Terminal (nhật ký, chỉ đọc)"
                                        aria-pressed={terminalOpen}
                                        title="Terminal (nhật ký, chỉ đọc)"
                                        onClick={() =>
                                            setTerminalOpen((open) => !open)
                                        }
                                        className={cn(
                                            'size-8 overflow-hidden text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-sm/chat:invisible @max-sm/chat:w-0 @max-sm/chat:px-0 @max-sm/chat:opacity-0',
                                            terminalOpen &&
                                                'bg-accent text-accent-foreground',
                                        )}
                                    >
                                        <Terminal aria-hidden="true" />
                                    </Button>
                                )}
                            {repo !== null && (
                                <>
                                    {!codeOpen && branchPopover}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Xem mã nguồn repo"
                                        aria-pressed={codeOpen}
                                        title={`Xem mã nguồn ${repo}`}
                                        onClick={() =>
                                            setCodeOpen((open) => !open)
                                        }
                                        className={cn(
                                            'size-8 overflow-hidden text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-sm/chat:invisible @max-sm/chat:w-0 @max-sm/chat:px-0 @max-sm/chat:opacity-0',
                                            codeOpen &&
                                                'bg-accent text-accent-foreground',
                                        )}
                                    >
                                        <Folder aria-hidden="true" />
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                    {cachedOpening === null &&
                    opening !== null &&
                    opening !== activeId ? (
                        <ThreadSkeleton />
                    ) : cachedOpening !== null ? (
                        <ChatThread
                            items={cachedOpening.map((message) => ({
                                ...message,
                                proposals: undefined,
                            }))}
                            pending={false}
                            assistant={assistantIdentity(
                                settings,
                                pickedAccount,
                            )}
                            onProposalsChange={() => undefined}
                        />
                    ) : (
                        <ChatPanel
                            showProjects={recentsTab === 'projects'}
                            key={activeId ?? 'new'}
                            onConversationId={setLiveChatId}
                            conversation={activeConversation}
                            initialMessages={messages}
                            aiAccounts={aiAccounts}
                            githubConnected={githubConnected}
                            repo={repo}
                            extraRepos={extraRepos}
                            onExtraReposChange={setExtraRepos}
                            onRepoChange={(name) => {
                                setRepo(name);

                                if (name === null) {
                                    setCodeOpen(false);
                                }
                            }}
                            agents={agents}
                            onAgentStart={startAgent}
                            onAgentStep={stepAgent}
                            onAgentEnd={endAgent}
                            onLog={addLog}
                            onChanges={setChanges}
                            proposalSync={proposalSync}
                            onOpenFile={(file, path) => {
                                setExtraRepos((current) =>
                                    file === repo || current.includes(file)
                                        ? current
                                        : [...current, file],
                                );
                                setViewedRepo(file === repo ? null : file);
                                setCodeOpen(true);
                                setOpenRequest({
                                    repo: file,
                                    path,
                                    id: Date.now(),
                                });
                            }}
                            onSession={setSession}
                            selection={selection}
                            onSelectionChange={setSelection}
                            mode={mode}
                            onModeChange={changeMode}
                            settings={settings}
                            askRequest={askRequest}
                            activeFile={activeFile}
                            markedFiles={markedFiles}
                            onPending={setPendingChat}
                        />
                    )}
                </section>
                {viewerFile && wide && (
                    <SidePanel
                        open={!viewerClosing}
                        width={
                            viewerExpanded
                                ? viewerBounds.max
                                : viewerWidth.width
                        }
                        dragging={viewerDragging}
                        label="Xem tệp"
                        maxWidthClass="max-w-full"
                        panelRef={viewerPanel}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                event.stopPropagation();
                                closeViewer();
                            }
                        }}
                    >
                        {!viewerExpanded && (
                            <ResizeHandle
                                label="Đổi độ rộng bảng xem tệp"
                                className="translate-x-0"
                                {...viewerWidth.handleProps}
                                onPointerDown={(event) => {
                                    setViewerDragging(true);
                                    viewerWidth.handleProps.onPointerDown(
                                        event,
                                    );
                                }}
                                onPointerUp={() => {
                                    setViewerDragging(false);
                                    viewerWidth.handleProps.onPointerUp();
                                }}
                                onPointerCancel={() => {
                                    setViewerDragging(false);
                                    viewerWidth.handleProps.onPointerCancel();
                                }}
                            />
                        )}
                        <FileViewer
                            file={viewerFile}
                            onClose={closeViewer}
                            expanded={viewerExpanded}
                            onToggleExpand={() =>
                                setViewerExpanded((value) => !value)
                            }
                        />
                    </SidePanel>
                )}
                {viewerFile && !wide && (
                    <Sheet open onOpenChange={() => setViewerFile(null)}>
                        <SheetContent
                            side="right"
                            className="w-full p-0 sm:max-w-md"
                        >
                            <SheetTitle className="sr-only">Xem tệp</SheetTitle>
                            <SheetDescription className="sr-only">
                                Xem trước và mã của tệp trong cuộc trò chuyện.
                            </SheetDescription>
                            <FileViewer
                                file={viewerFile}
                                onClose={() => setViewerFile(null)}
                                expanded={false}
                                onToggleExpand={() => undefined}
                            />
                        </SheetContent>
                    </Sheet>
                )}
                {wide && (
                    <SidePanel
                        open={infoOpen && !viewerFile}
                        width={infoWidth.width}
                        dragging={infoDragging}
                        label="Thông tin phiên chat"
                        maxWidthClass="max-w-full"
                    >
                        <ResizeHandle
                            label="Đổi độ rộng bảng thông tin"
                            className="translate-x-0"
                            {...infoWidth.handleProps}
                            onPointerDown={(event) => {
                                setInfoDragging(true);
                                infoWidth.handleProps.onPointerDown(event);
                            }}
                            onPointerUp={() => {
                                setInfoDragging(false);
                                infoWidth.handleProps.onPointerUp();
                            }}
                            onPointerCancel={() => {
                                setInfoDragging(false);
                                infoWidth.handleProps.onPointerCancel();
                            }}
                        />
                        {infoPanel}
                    </SidePanel>
                )}
                {wide && terminalVisible && !(codeOpen && repo !== null) && (
                    <SidePanel
                        open={terminalOpen}
                        width={terminalWidth.width}
                        dragging={terminalDragging}
                        label="Terminal"
                        maxWidthClass="max-w-full"
                    >
                        <ResizeHandle
                            label="Đổi độ rộng terminal"
                            className="translate-x-0"
                            {...terminalWidth.handleProps}
                            onPointerDown={(event) => {
                                setTerminalDragging(true);
                                terminalWidth.handleProps.onPointerDown(event);
                            }}
                            onPointerUp={() => {
                                setTerminalDragging(false);
                                terminalWidth.handleProps.onPointerUp();
                            }}
                            onPointerCancel={() => {
                                setTerminalDragging(false);
                                terminalWidth.handleProps.onPointerCancel();
                            }}
                        />
                        {terminal}
                    </SidePanel>
                )}
                {wide && terminalVisible && (
                    <SidePanel
                        open={browserOpen}
                        width={browserWidth.width}
                        dragging={browserDragging}
                        label="Trình duyệt"
                        maxWidthClass="max-w-full"
                    >
                        <ResizeHandle
                            label="Đổi độ rộng trình duyệt"
                            className="translate-x-0"
                            {...browserWidth.handleProps}
                            onPointerDown={(event) => {
                                setBrowserDragging(true);
                                browserWidth.handleProps.onPointerDown(event);
                            }}
                            onPointerUp={() => {
                                setBrowserDragging(false);
                                browserWidth.handleProps.onPointerUp();
                            }}
                            onPointerCancel={() => {
                                setBrowserDragging(false);
                                browserWidth.handleProps.onPointerCancel();
                            }}
                        />
                        {browserOpen && (
                            <BrowserPane
                                onClose={() => setBrowserOpen(false)}
                            />
                        )}
                    </SidePanel>
                )}
                {!wide && terminalVisible && (
                    <Sheet open={browserOpen} onOpenChange={setBrowserOpen}>
                        <SheetContent
                            side="right"
                            className="w-full p-0 sm:max-w-md"
                        >
                            <SheetTitle className="sr-only">
                                Trình duyệt
                            </SheetTitle>
                            <SheetDescription className="sr-only">
                                Xem dự án đang chạy trên máy.
                            </SheetDescription>
                            <BrowserPane
                                onClose={() => setBrowserOpen(false)}
                            />
                        </SheetContent>
                    </Sheet>
                )}
                {!wide && terminalVisible && (
                    <Sheet open={terminalOpen} onOpenChange={setTerminalOpen}>
                        <SheetContent
                            side="right"
                            className="w-full p-0 sm:max-w-md"
                        >
                            <SheetTitle className="sr-only">
                                Terminal
                            </SheetTitle>
                            <SheetDescription className="sr-only">
                                Nhật ký hoạt động của trang chat.
                            </SheetDescription>
                            {terminal}
                        </SheetContent>
                    </Sheet>
                )}
                {!wide && !viewerFile && (
                    <Sheet open={infoOpen} onOpenChange={toggleInfo}>
                        <SheetContent side="right" className="w-80 p-0">
                            <SheetTitle className="sr-only">
                                Thông tin phiên chat
                            </SheetTitle>
                            <SheetDescription className="sr-only">
                                Ngữ cảnh, thay đổi, môi trường và kết nối của
                                phiên chat.
                            </SheetDescription>
                            {infoPanel}
                        </SheetContent>
                    </Sheet>
                )}
                {codeOpen && repo !== null && (
                    // * With the project files open, the Terminal docks under them (top/bottom) instead of beside them.
                    <div className="flex min-h-0 max-w-full min-w-0 shrink flex-col">
                        <div className="flex min-h-0 flex-1 justify-end">
                            <CodeViewer
                                // * A new project starts with its own tree, open folders and file.
                                key={viewed}
                                repo={viewed ?? repo}
                                repos={[repo, ...extraRepos]}
                                onViewRepo={setViewedRepo}
                                onActiveFile={setActiveFile}
                                onMarkedFiles={setMarkedFiles}
                                aiSelection={selection}
                                assistant={sidebarAssistant}
                                onChangesUpdate={(updated) => {
                                    setProposalSync({
                                        id: Date.now(),
                                        updated,
                                    });
                                    setChanges((current) => [
                                        ...current.filter(
                                            (item) =>
                                                !updated.some(
                                                    (edit) =>
                                                        edit.id === item.id,
                                                ),
                                        ),
                                        ...updated,
                                    ]);
                                }}
                                onInlineAsk={async (
                                    reference,
                                    question,
                                    conversation,
                                    signal,
                                    onStep,
                                ) => {
                                    // * Same endpoint, account and project as the chat; the answer goes to the comment box, not the thread.
                                    const form = new FormData();

                                    form.append(
                                        'message',
                                        reference.startLine === 0
                                            ? `${referenceBlock(reference)}\n\n${question}`
                                            : `${referenceBlock(reference)}\n\nChỉ xử lý đoạn code đã chọn ở trên (dòng ${reference.startLine}-${reference.endLine} của \`${reference.path}\`); nếu cần sửa thì chỉ sửa đúng đoạn này, không đụng phần còn lại của tệp.\n\n${question}`,
                                    );

                                    if (conversation !== null) {
                                        form.append(
                                            'conversation_id',
                                            conversation,
                                        );
                                    }

                                    // * The first question opens a child session of the chat on screen; later ones continue it.
                                    if (
                                        conversation === null &&
                                        liveChatId !== null
                                    ) {
                                        form.append(
                                            'parent_conversation_id',
                                            liveChatId,
                                        );
                                    }

                                    // * Edits to a local folder are written at once: the file opens with the change in place (no review step); the arrow in its header takes it back.
                                    if (selection.accountId !== null) {
                                        form.append(
                                            'ai_account_id',
                                            String(selection.accountId),
                                        );
                                    }

                                    if (selection.model !== null) {
                                        form.append(
                                            'ai_model',
                                            selection.model,
                                        );
                                    }

                                    if (repo.startsWith('local:')) {
                                        form.append(
                                            'local_root',
                                            repo.slice(6),
                                        );
                                    } else {
                                        form.append('repo', repo);
                                    }

                                    const data =
                                        await postStream<AiChatSendResponse>(
                                            '/ai-chat/messages/stream',
                                            form,
                                            { signal, onStep },
                                        );

                                    // * Edits to a folder of this machine are already written: the file is reloaded and shown as a diff in the viewer, and the change is listed with the chat's other changes. The box only says which files changed.
                                    const edits =
                                        data.assistant_message.proposals ?? [];

                                    if (edits.length > 0) {
                                        setChanges((current) => [
                                            ...current.filter(
                                                (item) =>
                                                    !edits.some(
                                                        (edit) =>
                                                            edit.id === item.id,
                                                    ),
                                            ),
                                            ...edits,
                                        ]);
                                        invalidateAiChatCache(`tree.${repo}`);
                                        invalidateAiChatCache(`file.${repo}.`);
                                        setOpenRequest({
                                            repo,
                                            path: edits[0].path,
                                            id: Date.now(),
                                        });
                                    }

                                    return {
                                        answer:
                                            data.assistant_message.content +
                                            (edits.length > 0
                                                ? `\n\n**Đề xuất sửa:** ${edits.map((edit) => `\`${edit.path}\``).join(', ')}. Xem thay đổi ở khung tệp, bấm ✓ trên đầu khung để áp dụng.`
                                                : ''),
                                        conversation: data.conversation.id,
                                    };
                                }}
                                branch={viewedBranch}
                                headerActions={
                                    <>
                                        {branchPopover}
                                        {terminalVisible && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Terminal (nhật ký, chỉ đọc)"
                                                aria-pressed={terminalOpen}
                                                title="Terminal (nhật ký, chỉ đọc)"
                                                onClick={() =>
                                                    setTerminalOpen(
                                                        (open) => !open,
                                                    )
                                                }
                                                className={cn(
                                                    'size-8 shrink-0 text-muted-foreground',
                                                    terminalOpen &&
                                                        'bg-accent text-accent-foreground',
                                                )}
                                            >
                                                <Terminal aria-hidden="true" />
                                            </Button>
                                        )}
                                    </>
                                }
                                changes={changes}
                                openRequest={openRequest}
                                onAsk={(reference) =>
                                    setAskRequest({
                                        id: Date.now(),
                                        reference,
                                    })
                                }
                            />
                        </div>
                        {wide && terminalVisible && terminalOpen && (
                            <div className="h-64 min-h-0 min-w-[24rem] shrink-0 border-t border-l">
                                {terminal}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </FileViewerContext.Provider>
    );
}
