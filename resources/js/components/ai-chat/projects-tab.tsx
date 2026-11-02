import { Link, router } from '@inertiajs/react';
import { Folder, FolderOpen, Lock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SourceIcon } from '@/components/ai-chat/source-icon';
import { repos as reposRoute } from '@/actions/App/Http/Controllers/AiChatController';
import {
    LocalProjectDialog,
    localUnavailableReason,
} from '@/components/ai-chat/local-project-dialog';
import type {
    LocalProject,
    LocalProjectsChange,
    LocalRoot,
} from '@/components/ai-chat/local-project-dialog';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useCachedRequest } from '@/hooks/use-cached-request';
import { api } from '@/lib/api';
import { cachedRequest, invalidateAiChatCache } from '@/lib/ai-chat-cache';
import { requestErrorMessage } from '@/lib/ai-error';
import { OPEN_CONVERSATION_VISIT, PENDING_CHAT_ID } from '@/lib/ai-chat-visit';
import { cn } from '@/lib/utils';
import { home } from '@/routes';
import type { AiChatConversation, AiChatRepo } from '@/types';

const REPOS_TTL_MS = 5 * 60 * 1000;

/** * "Code" tab: the projects the person can open (GitHub repos the token can read, plus the allowed local folders); picking one selects it for the chat and opens its code. */
export function ProjectsTab({
    repo,
    onSelect,
    connected,
    conversations,
    activeId,
    onNavigate,
}: {
    repo: string | null;
    onSelect: (repo: string, extras?: string[]) => void;
    connected: boolean;
    /** * Saved chats; each project lists the ones held about it. */
    conversations: AiChatConversation[];
    activeId: string | null;
    onNavigate?: () => void;
}) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [repos, setRepos] = useState<AiChatRepo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    // * Same cached request as the "Máy local" menu: labels only, never a server path.
    const { data: local, mutate: mutateLocal } = useCachedRequest(
        'local.status',
        REPOS_TTL_MS,
        () =>
            api
                .get<{
                    enabled: boolean;
                    can_read: boolean;
                    can_write: boolean;
                    roots: LocalRoot[];
                    projects: LocalProject[];
                }>('/ai-chat/local/status')
                .then(({ data }) => data),
        true,
    );
    const [createOpen, setCreateOpen] = useState(false);
    // * The project whose chats are about to be deleted (the project itself stays in the list).
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const canCreate = local?.enabled === true && local.can_write;
    const localRows: AiChatRepo[] =
        local?.enabled && local.can_read
            ? local.roots.map((root) => ({
                  full_name: `local:${root.id}`,
                  private: false,
                  default_branch: '',
                  description: null,
              }))
            : [];

    useEffect(() => {
        if (!connected) {
            return;
        }

        let cancelled = false;

        // * One shared request for the repo list (kept 5 minutes): switching tabs or opening a chat does not refetch it.
        cachedRequest('github.repos', REPOS_TTL_MS, () =>
            api
                .get<{ repos: AiChatRepo[] }>(reposRoute.url())
                .then(({ data }) => data.repos),
        )
            .then((rows) => !cancelled && setRepos(rows))
            .catch((caught) => {
                if (!cancelled) {
                    setRepos([]);
                    setError(
                        requestErrorMessage(
                            caught,
                            'Không tải được danh sách repo.',
                        ),
                    );
                }
            });

        return () => {
            cancelled = true;
        };
    }, [connected]);

    if (!connected && localRows.length === 0) {
        return (
            <p className="px-2 text-sm text-muted-foreground">
                Chưa kết nối GitHub.{' '}
                <Link
                    href="/integrations/github"
                    className="underline underline-offset-2 hover:text-foreground"
                >
                    Kết nối
                </Link>
            </p>
        );
    }

    const projectsChanged = (change: LocalProjectsChange) => {
        invalidateAiChatCache('local.');

        if (local) {
            mutateLocal({ ...local, ...change });
        }
    };

    const confirmDelete = () => {
        if (pendingDelete === null) {
            return;
        }

        setDeleting(true);
        router.delete('/ai-chat/conversations', {
            data: { scope: 'repo', repo: pendingDelete },
            preserveScroll: true,
            onSuccess: () => setPendingDelete(null),
            onFinish: () => setDeleting(false),
        });
    };
    // * One conversation of a project (the trash button on its row), asked to confirm like the whole-project delete.
    const [pendingChat, setPendingChat] = useState<AiChatConversation | null>(
        null,
    );
    const confirmDeleteChat = () => {
        if (pendingChat === null) {
            return;
        }

        setDeleting(true);
        router.delete(`/ai-chat/conversations/${pendingChat.id}`, {
            preserveScroll: true,
            onSuccess: () => setPendingChat(null),
            onFinish: () => setDeleting(false),
        });
    };
    const pendingCount = conversations.filter(
        (conversation) => conversation.repo === pendingDelete,
    ).length;

    const query = search.trim().toLowerCase();
    const shown = [...(connected ? (repos ?? []) : []), ...localRows].filter(
        (row) => row.full_name.toLowerCase().includes(query),
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex items-center justify-between gap-2 px-1">
                <h2 className="text-sm font-medium text-muted-foreground">
                    Dự án
                </h2>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    title="Tạo mới dự án"
                    onClick={() => setCreateOpen(true)}
                >
                    <Plus aria-hidden="true" />
                    Thêm mới dự án
                </Button>
            </div>
            <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Tìm repo"
                placeholder="Tìm repo..."
                className="h-8 font-medium placeholder:font-normal"
            />
            <LocalProjectDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                projects={local?.projects ?? []}
                onChanged={projectsChanged}
                githubRepos={connected ? repos : null}
                onPickRepos={(list) => {
                    if (list.length > 0) {
                        onSelect(list[0], list.slice(1));
                    }
                }}
                title="Tạo mới dự án"
                initialSource="local"
                unavailable={localUnavailableReason(local)}
                localRoots={local?.enabled && local.can_read ? local.roots : []}
                selected={repo === null ? [] : [repo]}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
                {connected && repos === null ? (
                    <p className="px-2 text-sm text-muted-foreground">
                        Đang tải...
                    </p>
                ) : error !== null ? (
                    <p role="alert" className="px-2 text-sm text-destructive">
                        {error}
                    </p>
                ) : shown.length === 0 ? (
                    <p className="px-2 text-sm text-muted-foreground">
                        Không có repo nào.
                    </p>
                ) : (
                    <ul className="flex flex-col gap-0.5">
                        {shown.map((row) => {
                            const chats = conversations.filter(
                                (conversation) =>
                                    conversation.repo === row.full_name,
                            );
                            // * The project of the open chat is always shown open.
                            const isOpen =
                                expanded.has(row.full_name) ||
                                chats.some(
                                    (conversation) =>
                                        conversation.id === activeId ||
                                        conversation.id === PENDING_CHAT_ID,
                                );

                            return (
                                <li
                                    key={row.full_name}
                                    className="group relative"
                                >
                                    <button
                                        type="button"
                                        aria-expanded={isOpen}
                                        onClick={() => {
                                            setExpanded((current) => {
                                                const next = new Set(current);

                                                if (
                                                    !next.delete(row.full_name)
                                                ) {
                                                    next.add(row.full_name);
                                                }

                                                return next;
                                            });
                                            onSelect(row.full_name);
                                        }}
                                        aria-current={
                                            row.full_name === repo
                                                ? 'true'
                                                : undefined
                                        }
                                        className={cn(
                                            'flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left text-sm font-medium transition-colors duration-150 group-focus-within:pr-9 group-hover:pr-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
                                            row.full_name === repo &&
                                                'bg-accent text-accent-foreground',
                                        )}
                                    >
                                        {row.full_name.startsWith('local:') ? (
                                            isOpen ? (
                                                <FolderOpen
                                                    aria-hidden="true"
                                                    className="size-4 shrink-0 text-muted-foreground"
                                                />
                                            ) : (
                                                <Folder
                                                    aria-hidden="true"
                                                    className="size-4 shrink-0 text-muted-foreground"
                                                />
                                            )
                                        ) : (
                                            <SourceIcon
                                                local={false}
                                                className="text-muted-foreground"
                                            />
                                        )}
                                        <span className="truncate">
                                            {row.full_name.startsWith('local:')
                                                ? row.full_name.slice(6)
                                                : row.full_name}
                                        </span>
                                        {row.private && (
                                            <Lock
                                                aria-label="Riêng tư"
                                                className="size-3 shrink-0 text-muted-foreground"
                                            />
                                        )}
                                        {chats.length > 0 && (
                                            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                                                {chats.length}
                                            </span>
                                        )}
                                    </button>
                                    {chats.length > 0 && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Xoá các cuộc trò chuyện của ${row.full_name}`}
                                            title="Xoá các cuộc trò chuyện của dự án"
                                            onClick={() =>
                                                setPendingDelete(row.full_name)
                                            }
                                            className="absolute top-1 right-1 size-7 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-transparent hover:text-destructive"
                                        >
                                            <Trash2 aria-hidden="true" />
                                        </Button>
                                    )}
                                    {isOpen && (
                                        <ul className="mt-0.5 mb-1 ml-4 flex flex-col gap-0.5 pl-3">
                                            <li>
                                                {/* * Same action as picking the project (a fresh chat for it); the name is plain text. */}
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        onSelect(row.full_name)
                                                    }
                                                    aria-label={`Cuộc trò chuyện mới trong ${row.full_name}`}
                                                    className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm font-medium text-foreground/70 transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                                                >
                                                    <Plus
                                                        aria-hidden="true"
                                                        className="size-3.5 shrink-0"
                                                    />
                                                    Cuộc trò chuyện mới
                                                </button>
                                            </li>
                                            {chats.length === 0 ? (
                                                <li className="px-2 py-1 text-sm text-foreground/70">
                                                    Chưa có đoạn chat nào.
                                                </li>
                                            ) : (
                                                chats.map((conversation) =>
                                                    conversation.id ===
                                                    PENDING_CHAT_ID ? (
                                                        <li
                                                            key={
                                                                conversation.id
                                                            }
                                                            aria-busy="true"
                                                            className="block truncate rounded-lg bg-accent px-2 py-1.5 text-sm text-accent-foreground"
                                                        >
                                                            {conversation.title}
                                                        </li>
                                                    ) : (
                                                        <li
                                                            key={
                                                                conversation.id
                                                            }
                                                            className="group relative"
                                                        >
                                                            <Link
                                                                href={home.url({
                                                                    query: {
                                                                        c: conversation.id,
                                                                    },
                                                                })}
                                                                {...OPEN_CONVERSATION_VISIT}
                                                                onClick={
                                                                    onNavigate
                                                                }
                                                                aria-current={
                                                                    conversation.id ===
                                                                    activeId
                                                                        ? 'page'
                                                                        : undefined
                                                                }
                                                                className={cn(
                                                                    'text-foreground/80transition-colors block truncate rounded-lg px-2 py-1.5 pr-9 text-sm duration-150 hover:bg-accent hover:text-accent-foreground motion-reduce:transition-none',
                                                                    conversation.id ===
                                                                        activeId &&
                                                                        'bg-accent text-accent-foreground',
                                                                )}
                                                            >
                                                                {
                                                                    conversation.title
                                                                }
                                                            </Link>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                aria-label={`Xoá cuộc trò chuyện ${conversation.title}`}
                                                                onClick={() =>
                                                                    setPendingChat(
                                                                        conversation,
                                                                    )
                                                                }
                                                                className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive"
                                                            >
                                                                <Trash2 aria-hidden="true" />
                                                            </Button>
                                                        </li>
                                                    ),
                                                )
                                            )}
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            <Dialog
                open={pendingChat !== null}
                onOpenChange={(open) => !open && setPendingChat(null)}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Xoá cuộc trò chuyện?</DialogTitle>
                        <DialogDescription>
                            Cuộc trò chuyện “{pendingChat?.title}” sẽ bị xoá
                            vĩnh viễn cùng tin nhắn và đề xuất sửa tệp. Không
                            hoàn tác được.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setPendingChat(null)}
                            disabled={deleting}
                        >
                            Huỷ
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={confirmDeleteChat}
                            disabled={deleting}
                        >
                            Xoá
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={pendingDelete !== null}
                onOpenChange={(open) => !open && setPendingDelete(null)}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Xoá các cuộc trò chuyện?</DialogTitle>
                        <DialogDescription>
                            {pendingCount} cuộc trò chuyện của dự án{' '}
                            {pendingDelete?.replace(/^local:/, '')} sẽ bị xoá
                            vĩnh viễn cùng tin nhắn và đề xuất sửa tệp. Dự án và
                            mã nguồn không bị đụng tới. Không hoàn tác được.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setPendingDelete(null)}
                            disabled={deleting}
                        >
                            Huỷ
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={confirmDelete}
                            disabled={deleting}
                        >
                            Xoá
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
