import { Head, router, usePage } from '@inertiajs/react';
import {
    Folder,
    Globe,
    Menu,
    PanelLeft,
    PanelRight,
    Terminal,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    optimize,
    send,
} from '@/actions/App/Http/Controllers/AiChatController';
import { ActivityTerminal } from '@/components/ai-chat/activity-terminal';
import type { ActivityEntry } from '@/components/ai-chat/activity-terminal';
import { ChatComposer } from '@/components/ai-chat/chat-composer';
import { CodeViewer } from '@/components/ai-chat/code-viewer';
import { ChatThread } from '@/components/ai-chat/chat-thread';
import type { ThreadItem } from '@/components/ai-chat/chat-thread';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { SessionPanel } from '@/components/ai-chat/session-panel';
import { LocalSourceMenu } from '@/components/ai-chat/local-source-menu';
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
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { aiErrorMessage } from '@/lib/ai-error';
import { api } from '@/lib/api';
import { readAiChatCache, writeAiChatCache } from '@/lib/ai-chat-cache';
import { cn } from '@/lib/utils';
import { home } from '@/routes';
import type {
    Auth,
    AiChatAccount,
    AiChatConversation,
    AiChatMessage,
    AiChatMode,
    AiChatPageProps,
    AiChatProposal,
    AiChatSelection,
    AiChatSendResponse,
} from '@/types';

// * Same cap as `SendAiChatMessageRequest::MAX_MESSAGE_LENGTH`.
const MAX_MESSAGE_LENGTH = 2000;

// * Sample prompt the code viewer's "Review" button drops into the draft; the user edits it and sends it.
const REVIEW_PROMPT =
    'tìm lỗi logic, bảo mật, hiệu năng và đề xuất cách sửa cụ thể: ';

const MODE_KEY = 'ai-chat:mode';

// * Newest messages of an opened conversation kept in sessionStorage so reopening it shows them at once.
const CACHED_MESSAGES = 50;

type SessionState = { items: ThreadItem[]; accountId: number | null };

const INFO_OPEN_KEY = 'ai-chat.info-open';

type AiChatMention = { path: string; n: number; review?: boolean };

// * Same limits as `SendAiChatMessageRequest` / `ChatAttachmentReader::extensions()`.
const MAX_ATTACHMENTS = 5;
const ATTACHMENT_EXTENSIONS = [
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
    repo,
    onRepoChange,
    mention,
    onLog,
    onChanges,
    onSession,
}: {
    conversation: AiChatConversation | null;
    initialMessages: AiChatMessage[];
    aiAccounts: AiChatAccount[];
    githubConnected: boolean;
    repo: string | null;
    onRepoChange: (repo: string | null) => void;
    /** * A file the person asked the AI to read from the code viewer; each request has a new `n`. */
    mention: AiChatMention | null;
    /** * Adds a line to the read-only activity terminal. */
    onLog: (level: ActivityEntry['level'], text: string) => void;
    /** * The files the AI proposed to change in this conversation, for the code viewer. */
    onChanges: (proposals: AiChatProposal[]) => void;
    /** * The live thread and the picked AI account, for the read-only session panel. */
    onSession: (session: SessionState) => void;
}) {
    // * The first connected account is the one tried first; the person can pick another per message.
    const [selection, setSelection] = useState<AiChatSelection>(() => {
        const first =
            aiAccounts.find((account) => account.status === 'connected') ??
            aiAccounts[0];

        return { accountId: first?.id ?? null, model: first?.model ?? null };
    });
    const [items, setItems] = useState<ThreadItem[]>(initialMessages);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [files, setFiles] = useState<File[]>([]);
    const [optimizing, setOptimizing] = useState(false);
    // * Answer mode: "auto" is the normal reply, "plan" asks for a plan only. Kept until changed (this tab only).
    const [mode, setMode] = useState<AiChatMode>(() => {
        try {
            return sessionStorage.getItem(MODE_KEY) === 'plan'
                ? 'plan'
                : 'auto';
        } catch {
            return 'auto';
        }
    });
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
    // * The code viewer's "Nhờ AI đọc tệp này" appends a line to the draft (a request made before this chat opened is ignored).
    const handledMention = useRef(mention?.n ?? 0);

    useEffect(() => {
        if (mention === null || mention.n === handledMention.current) {
            return;
        }

        handledMention.current = mention.n;
        setDraft((current) =>
            `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${mention.review ? `Review tệp ${mention.path}: ${REVIEW_PROMPT}` : `Đọc tệp ${mention.path}: `}`.slice(
                0,
                MAX_MESSAGE_LENGTH,
            ),
        );
    }, [mention]);

    useEffect(() => {
        onChanges(items.flatMap((item) => item.proposals ?? []));
    }, [items, onChanges]);

    useEffect(() => {
        onSession({ items, accountId: selection.accountId });
    }, [items, selection.accountId, onSession]);

    const conversationId = useRef<string | null>(conversation?.id ?? null);
    const nextLocalId = useRef(0);

    /** `chosen`: text of a picked ```choices option, sent as-is; the draft and attachments stay untouched. */
    const submit = async (chosen?: string) => {
        const text = (chosen ?? draft).trim();

        if (text === '' || sending) {
            return;
        }

        const localId = `local-${nextLocalId.current++}`;

        const sentFiles = chosen === undefined ? files : [];

        if (chosen === undefined) {
            setDraft('');
            setPreviousDraft(null);
            setFiles([]);
        }

        setSending(true);
        setItems((current) => [
            ...current.filter((item) => item.role !== 'error'),
            {
                id: localId,
                role: 'user',
                content: text,
            },
        ]);

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

            const { data } = await api.post<AiChatSendResponse>(
                send.url(),
                form,
            );

            const proposals = data.assistant_message.proposals ?? [];
            const pull = proposals.find((proposal) => proposal.pull_url);

            onLog('ok', 'AI đã trả lời.');

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

            conversationId.current = data.conversation.id;
            setItems((current) => [
                ...current.filter((item) => item.id !== localId),
                data.user_message,
                data.assistant_message,
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
            if (isNew) {
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
            setSending(false);
        }
    };

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
                onSubmit={() => void submit()}
                sending={sending}
                maxLength={MAX_MESSAGE_LENGTH}
                autoFocus
                accounts={aiAccounts}
                selection={selection}
                onSelectionChange={setSelection}
                files={files}
                onFilesChange={setFiles}
                acceptedExtensions={ATTACHMENT_EXTENSIONS}
                maxFiles={MAX_ATTACHMENTS}
                repo={repo}
                onRepoChange={onRepoChange}
                githubConnected={githubConnected}
                mode={mode}
                onModeChange={(value) => {
                    setMode(value);

                    try {
                        sessionStorage.setItem(MODE_KEY, value);
                    } catch {
                        // * Storage can be blocked; the mode still applies for this visit.
                    }
                }}
                autoPr={autoPr}
                onAutoPrChange={(value) => {
                    setAutoPr(value);

                    try {
                        localStorage.setItem(AUTO_PR_KEY, value ? '1' : '0');
                    } catch {
                        // * Storage can be blocked; the switch still works for this visit.
                    }
                }}
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
                    <div className="flex flex-1 items-center justify-center px-4">
                        <h1 className="text-center text-2xl font-semibold">
                            Hôm nay bạn muốn làm gì?
                        </h1>
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
                    onChoose={(text) => void submit(text)}
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

export default function AiChatIndex({
    conversations,
    activeConversation,
    messages,
    aiAccounts,
    githubConnected,
    chatContext,
    integrations,
}: AiChatPageProps) {
    const userId = usePage<{ auth: Auth }>().props.auth.user.id;
    const [session, setSession] = useState<SessionState>({
        items: messages,
        accountId: null,
    });
    const [infoOpen, setInfoOpen] = useState(() => {
        try {
            return sessionStorage.getItem(INFO_OPEN_KEY) === '1';
        } catch {
            return false;
        }
    });
    const [wide, setWide] = useState(
        () => window.matchMedia('(min-width: 1024px)').matches,
    );
    const infoWidth = useResizableWidth('ai-chat.width.info', 288, 220, 480);

    useEffect(() => {
        const query = window.matchMedia('(min-width: 1024px)');
        const update = () => setWide(query.matches);

        query.addEventListener('change', update);

        return () => query.removeEventListener('change', update);
    }, []);

    const toggleInfo = () =>
        setInfoOpen((open) => {
            try {
                sessionStorage.setItem(INFO_OPEN_KEY, open ? '0' : '1');
            } catch {
                // * Storage blocked: the panel still toggles for this visit.
            }

            return !open;
        });
    const [recentsOpen, setRecentsOpen] = useState(false);
    const [recentsCollapsed, setRecentsCollapsed] = useState(false);
    const activeId = activeConversation?.id ?? null;
    // * The repo and its code viewer belong to the page, so the "Code" tab and the chat share them across conversations.
    const [repo, setRepo] = useState<string | null>(null);
    const [codeOpen, setCodeOpen] = useState(false);
    const [changes, setChanges] = useState<AiChatProposal[]>([]);
    const [terminalOpen, setTerminalOpen] = useState(false);
    // * The Terminal belongs to the "Code" tab: other tabs only hide it (its open state and log are kept).
    const [recentsTab, setRecentsTab] = useState<RecentsTab>('chat');
    const terminalVisible = recentsTab === 'projects';
    const [log, setLog] = useState<ActivityEntry[]>([]);
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
    const [mention, setMention] = useState<AiChatMention | null>(null);
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
            setRepo(activeRepo);
        }
    }, [activeRepo, activeId]);

    const selectRepo = (name: string) => {
        setRepo(name);
        setCodeOpen(true);
        addLog('info', `Chọn repo ${name}`);

        // * Picking a project starts a fresh chat for it.
        if (activeId !== null) {
            router.get(home.url());
        }
    };
    const pickedAccount = aiAccounts.find(
        (account) => account.id === session.accountId,
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
        <>
            <Head title="Trợ lý AI" />
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
                            conversations={conversations}
                            aiAccounts={aiAccounts}
                            activeId={activeId}
                            onCollapse={() => setRecentsCollapsed(true)}
                            repo={repo}
                            onSelectRepo={selectRepo}
                            githubConnected={githubConnected}
                            tab={recentsTab}
                            onTabChange={setRecentsTab}
                        />
                    </div>
                </aside>

                <section
                    aria-label="Trò chuyện với trợ lý AI"
                    className="relative flex min-h-0 min-w-0 flex-1 flex-col"
                >
                    <div
                        className={cn(
                            // * No header bar: the buttons float over the chat's top corners so a folded list leaves no empty strip.
                            'pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center p-2 [&>*]:pointer-events-auto',
                            // * On wide screens they are only needed for the collapsed-list button and the code button.
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
                                    conversations={conversations}
                                    aiAccounts={aiAccounts}
                                    activeId={activeId}
                                    onNavigate={() => setRecentsOpen(false)}
                                    repo={repo}
                                    onSelectRepo={selectRepo}
                                    githubConnected={githubConnected}
                                    tab={recentsTab}
                                    onTabChange={setRecentsTab}
                                />
                            </SheetContent>
                        </Sheet>
                        <div className="ml-auto flex items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Thông tin phiên chat"
                                aria-pressed={infoOpen}
                                title="Thông tin phiên chat"
                                onClick={toggleInfo}
                                className={cn(
                                    'size-8 text-muted-foreground',
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
                                    aria-label="Terminal (nhật ký, chỉ đọc)"
                                    aria-pressed={terminalOpen}
                                    title="Terminal (nhật ký, chỉ đọc)"
                                    onClick={() =>
                                        setTerminalOpen((open) => !open)
                                    }
                                    className={cn(
                                        'size-8 text-muted-foreground',
                                        terminalOpen &&
                                            'bg-accent text-accent-foreground',
                                    )}
                                >
                                    <Terminal aria-hidden="true" />
                                </Button>
                            )}
                            <LocalSourceMenu
                                onSelect={(id) => selectRepo(`local:${id}`)}
                            />
                            {repo !== null && (
                                <>
                                    {!repo.startsWith('local:') && (
                                        <Button
                                            asChild
                                            variant="ghost"
                                            size="icon"
                                            className="size-8 text-muted-foreground"
                                        >
                                            <a
                                                href={`https://github.com/${repo}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                aria-label={`Mở ${repo} trên GitHub`}
                                                title={`Mở ${repo} trên GitHub`}
                                            >
                                                <Globe aria-hidden="true" />
                                            </a>
                                        </Button>
                                    )}
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
                                            'size-8 text-muted-foreground',
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
                    {cachedOpening !== null ? (
                        <ChatThread
                            items={cachedOpening.map((message) => ({
                                ...message,
                                proposals: undefined,
                            }))}
                            pending={false}
                            onProposalsChange={() => undefined}
                        />
                    ) : (
                        <ChatPanel
                            key={activeId ?? 'new'}
                            conversation={activeConversation}
                            initialMessages={messages}
                            aiAccounts={aiAccounts}
                            githubConnected={githubConnected}
                            repo={repo}
                            onRepoChange={(name) => {
                                setRepo(name);

                                if (name === null) {
                                    setCodeOpen(false);
                                }
                            }}
                            mention={mention}
                            onLog={addLog}
                            onChanges={setChanges}
                            onSession={setSession}
                        />
                    )}
                    {terminalOpen && terminalVisible && (
                        <ActivityTerminal
                            entries={log}
                            onClear={() => setLog([])}
                            onClose={() => setTerminalOpen(false)}
                        />
                    )}
                </section>
                {infoOpen && wide && (
                    <aside
                        aria-label="Thông tin phiên chat"
                        style={{ width: infoWidth.width }}
                        className="relative flex min-h-0 max-w-[40%] shrink-0 flex-col border-l"
                    >
                        <ResizeHandle
                            label="Đổi độ rộng bảng thông tin"
                            {...infoWidth.handleProps}
                        />
                        {infoPanel}
                    </aside>
                )}
                {!wide && (
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
                    <CodeViewer
                        repo={repo}
                        changes={changes}
                        onClose={() => setCodeOpen(false)}
                        onMention={(path) =>
                            setMention((current) => ({
                                path,
                                n: (current?.n ?? 0) + 1,
                            }))
                        }
                        onReview={(path) =>
                            setMention((current) => ({
                                path,
                                n: (current?.n ?? 0) + 1,
                                review: true,
                            }))
                        }
                    />
                )}
            </div>
        </>
    );
}
