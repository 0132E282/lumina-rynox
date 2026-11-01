import { Link } from '@inertiajs/react';
import { ChevronDown, ChevronRight, Lock, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { repos as reposRoute } from '@/actions/App/Http/Controllers/AiChatController';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cachedRequest } from '@/lib/ai-chat-cache';
import { requestErrorMessage } from '@/lib/ai-error';
import { OPEN_CONVERSATION_VISIT } from '@/lib/ai-chat-visit';
import { cn } from '@/lib/utils';
import { home } from '@/routes';
import type { AiChatConversation, AiChatRepo } from '@/types';

const REPOS_TTL_MS = 5 * 60 * 1000;

/** * "Code" tab: the GitHub repos the token can read; picking one selects it for the chat and opens its code. */
export function ProjectsTab({
    repo,
    onSelect,
    connected,
    conversations,
    activeId,
    onNavigate,
}: {
    repo: string | null;
    onSelect: (repo: string) => void;
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

    if (!connected) {
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

    const query = search.trim().toLowerCase();
    const shown = (repos ?? []).filter((row) =>
        row.full_name.toLowerCase().includes(query),
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Tìm repo"
                placeholder="Tìm repo..."
                className="h-8"
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
                {repos === null ? (
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
                                        conversation.id === activeId,
                                );

                            return (
                                <li key={row.full_name}>
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
                                            'flex w-full items-center gap-1.5 rounded-sm px-2 py-2 text-left text-sm transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
                                            row.full_name === repo &&
                                                'bg-accent text-accent-foreground',
                                        )}
                                    >
                                        {isOpen ? (
                                            <ChevronDown
                                                aria-hidden="true"
                                                className="size-3.5 shrink-0"
                                            />
                                        ) : (
                                            <ChevronRight
                                                aria-hidden="true"
                                                className="size-3.5 shrink-0"
                                            />
                                        )}
                                        <span className="truncate">
                                            {row.full_name}
                                        </span>
                                        {row.private && (
                                            <Lock
                                                aria-label="Riêng tư"
                                                className="size-3 shrink-0 text-muted-foreground"
                                            />
                                        )}
                                        {chats.length > 0 && (
                                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                                {chats.length}
                                            </span>
                                        )}
                                    </button>
                                    {isOpen && (
                                        <ul className="mt-0.5 mb-1 ml-5 flex flex-col gap-0.5 border-l pl-2">
                                            <li>
                                                {/* * Same action as picking the project (a fresh chat for it); the name is plain text. */}
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        onSelect(row.full_name)
                                                    }
                                                    aria-label={`Cuộc trò chuyện mới trong ${row.full_name}`}
                                                    className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                                                >
                                                    <Plus
                                                        aria-hidden="true"
                                                        className="size-3.5 shrink-0"
                                                    />
                                                    Cuộc trò chuyện mới
                                                </button>
                                            </li>
                                            {chats.length === 0 ? (
                                                <li className="px-2 py-1 text-xs text-muted-foreground">
                                                    Chưa có đoạn chat nào.
                                                </li>
                                            ) : (
                                                chats.map((conversation) => (
                                                    <li key={conversation.id}>
                                                        <Link
                                                            href={home.url({
                                                                query: {
                                                                    c: conversation.id,
                                                                },
                                                            })}
                                                            {...OPEN_CONVERSATION_VISIT}
                                                            onClick={onNavigate}
                                                            aria-current={
                                                                conversation.id ===
                                                                activeId
                                                                    ? 'page'
                                                                    : undefined
                                                            }
                                                            className={cn(
                                                                'block truncate rounded-sm px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-accent hover:text-accent-foreground motion-reduce:transition-none',
                                                                conversation.id ===
                                                                    activeId &&
                                                                    'bg-accent text-accent-foreground',
                                                            )}
                                                        >
                                                            {conversation.title}
                                                        </Link>
                                                    </li>
                                                ))
                                            )}
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
