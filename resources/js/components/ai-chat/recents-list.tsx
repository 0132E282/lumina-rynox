import { Link, usePage } from '@inertiajs/react';
import { vendorShortName } from '@/lib/ai-account';
import {
    ChartColumn,
    MessageSquare,
    MoreVertical,
    PanelLeft,
    Search,
    Settings,
    SquarePen,
} from 'lucide-react';
import { memo, useState } from 'react';
import { filterNavItems } from '@/components/nav-main';
import { OPEN_CONVERSATION_VISIT } from '@/lib/ai-chat-visit';
import { home } from '@/routes';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from '@/components/ui/dialog';
import { ProjectsTab } from '@/components/ai-chat/projects-tab';
import { RowActionsMenu } from '@/components/tables/row-actions-menu';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import { Input } from '@/components/ui/input';
import type { NavigationConfig } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { groupByDay } from '@/lib/relative-time';
import type { AiChatAccount, AiChatConversation } from '@/types';

const STATUS_LABELS: Record<string, string> = {
    connected: 'Đã kết nối',
    error: 'Lỗi kết nối',
    disconnected: 'Chưa kết nối',
};

/** * "New chat" button and the "Gần đây" list (latest conversations of the signed-in admin). */
export type RecentsTab = 'chat' | 'projects';

export const RecentsList = memo(function RecentsList({
    conversations,
    aiAccounts,
    assistant,
    account,
    activeId,
    onNavigate,
    onCollapse,
    repo,
    onSelectRepo,
    githubConnected,
    tab,
    onTabChange,
    onOpenSettings,
    onOpenStats,
}: {
    conversations: AiChatConversation[];
    aiAccounts: AiChatAccount[];
    /** * The assistant's name and avatar (the character), shown in the footer row. */
    assistant: AssistantIdentity;
    /** * The AI account answering now: the row's small second line and status dot. */
    account?: AiChatAccount;
    activeId: string | null;
    onNavigate?: () => void;
    onCollapse?: () => void;
    repo: string | null;
    onSelectRepo: (repo: string, extras?: string[]) => void;
    githubConnected: boolean;
    /** * Active tab, owned by the page (the Terminal only shows on "projects"). */
    tab: RecentsTab;
    onTabChange: (tab: RecentsTab) => void;
    /** * Opens the chat-settings dialog ("Cài đặt chat"). */
    onOpenSettings: () => void;
    /** * Opens the "Thống kê AI" dialog. */
    onOpenStats: () => void;
}) {
    const { navigation } = usePage<{ navigation: NavigationConfig }>().props;
    const [search, setSearch] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [filter, setFilter] = useState('');
    // * Chat and Code chats are two separate things: the Chat tab (and its search) holds the chats without a repo, the Code tab those with one.
    const scoped = conversations.filter((conversation) =>
        tab === 'projects'
            ? conversation.repo !== null
            : conversation.repo === null,
    );
    const query = search.trim().toLowerCase();
    const menuResults = query
        ? filterNavItems(
              navigation.main.flatMap((group) =>
                  group.items.map(({ title, url }) => ({ title, url })),
              ),
              search,
          )
        : [];
    const chatResults = query
        ? scoped.filter((conversation) =>
              conversation.title.toLowerCase().includes(query),
          )
        : scoped;
    const recents = conversations.filter((conversation) =>
        conversation.title.toLowerCase().includes(filter.trim().toLowerCase()),
    );
    const closeSearch = () => {
        setSearchOpen(false);
        setSearch('');
    };
    const resultClass =
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 hover:bg-accent hover:text-accent-foreground motion-reduce:transition-none';

    return (
        <nav
            aria-label="Trò chuyện với trợ lý AI"
            className="flex min-h-0 flex-1 flex-col gap-3 p-3"
        >
            <div className="flex items-center justify-between pl-2">
                <span className="truncate text-base font-semibold">
                    Trợ lý AI
                </span>
                <div className="flex items-center">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Tìm kiếm"
                        aria-haspopup="dialog"
                        onClick={() => setSearchOpen(true)}
                        className="size-8 text-muted-foreground"
                    >
                        <Search aria-hidden="true" />
                    </Button>
                    {onCollapse && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Thu gọn danh sách"
                            onClick={onCollapse}
                            className="size-8 text-muted-foreground"
                        >
                            <PanelLeft aria-hidden="true" />
                        </Button>
                    )}
                </div>
            </div>
            <div
                role="tablist"
                aria-label="Chat và dự án"
                className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
            >
                {(
                    [
                        ['chat', 'Chat'],
                        ['projects', 'Code'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        id={`recents-tab-${key}`}
                        aria-selected={tab === key}
                        aria-controls="recents-tabpanel"
                        onClick={() => onTabChange(key)}
                        className={cn(
                            'rounded-md px-3 py-1 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
                            tab === key
                                ? 'bg-background font-medium shadow-sm'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <Dialog
                open={searchOpen}
                onOpenChange={(open) =>
                    open ? setSearchOpen(true) : closeSearch()
                }
            >
                <DialogContent
                    showCloseButton
                    className="top-[20%] flex max-h-[60vh] translate-y-0 flex-col gap-0 p-0 sm:max-w-2xl"
                >
                    <DialogTitle className="sr-only">Tìm kiếm</DialogTitle>
                    <DialogDescription className="sr-only">
                        Tìm cuộc trò chuyện và mục menu.
                    </DialogDescription>
                    <div className="relative border-b">
                        <Search
                            aria-hidden="true"
                            className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            autoFocus
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            aria-label="Tìm cuộc trò chuyện và menu"
                            placeholder="Tìm cuộc trò chuyện và menu..."
                            className="h-14 rounded-none border-0 pr-12 pl-11 shadow-none focus-visible:ring-0"
                        />
                    </div>
                    <div className="flex min-h-0 flex-col gap-1 overflow-y-auto p-2">
                        {chatResults.length === 0 &&
                            menuResults.length === 0 && (
                                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                                    Không tìm thấy kết quả phù hợp.
                                </p>
                            )}
                        {chatResults.map((conversation) => (
                            <Link
                                key={conversation.id}
                                href={home.url({
                                    query: { c: conversation.id },
                                })}
                                {...OPEN_CONVERSATION_VISIT}
                                onClick={() => {
                                    closeSearch();
                                    onNavigate?.();
                                }}
                                className={resultClass}
                            >
                                <MessageSquare
                                    aria-hidden="true"
                                    className="size-4 shrink-0 text-muted-foreground"
                                />
                                <span className="truncate">
                                    {conversation.title}
                                </span>
                            </Link>
                        ))}
                        {menuResults.map((item) => (
                            <Link
                                key={item.url}
                                href={item.url}
                                onClick={() => {
                                    closeSearch();
                                    onNavigate?.();
                                }}
                                className={resultClass}
                            >
                                <Search
                                    aria-hidden="true"
                                    className="size-4 shrink-0 text-muted-foreground"
                                />
                                <span className="truncate">{item.title}</span>
                            </Link>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
            <div
                role="tabpanel"
                id="recents-tabpanel"
                aria-labelledby={`recents-tab-${tab}`}
                className="flex min-h-0 flex-1 flex-col gap-3"
            >
                {tab === 'projects' ? (
                    <ProjectsTab
                        repo={repo}
                        onSelect={(name, extras) => {
                            onSelectRepo(name, extras);
                            onNavigate?.();
                        }}
                        connected={githubConnected}
                        conversations={conversations}
                        activeId={activeId}
                        onNavigate={onNavigate}
                    />
                ) : (
                    <>
                        <Button
                            asChild
                            variant="outline"
                            className="justify-start"
                            onClick={onNavigate}
                        >
                            <Link href={home.url()}>
                                <SquarePen aria-hidden="true" />
                                Cuộc trò chuyện mới
                            </Link>
                        </Button>
                        {scoped.length === 0 ? (
                            <>
                                <h2 className="px-2 text-sm font-medium text-foreground/70">
                                    Gần đây
                                </h2>
                                <p className="px-2 text-sm text-muted-foreground">
                                    Chưa có cuộc trò chuyện nào.
                                </p>
                            </>
                        ) : (
                            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
                                {groupByDay(
                                    scoped,
                                    (conversation) => conversation.updated_at,
                                ).map((group) => (
                                    <section
                                        key={group.label}
                                        aria-label={group.label}
                                        className="flex flex-col gap-0.5"
                                    >
                                        <h2 className="px-2 pb-1 text-sm font-medium text-foreground/70">
                                            {group.label}
                                        </h2>
                                        <ul className="flex flex-col gap-0.5">
                                            {group.items.map((conversation) => (
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
                                                            'block truncate rounded-sm px-2 py-2 text-sm font-medium transition-colors duration-150 hover:bg-accent hover:text-accent-foreground motion-reduce:transition-none',
                                                            conversation.id ===
                                                                activeId &&
                                                                'bg-accent text-accent-foreground',
                                                        )}
                                                    >
                                                        {conversation.title}
                                                    </Link>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
            <section
                aria-label="AI đang kết nối"
                className="-mx-3 mt-auto -mb-3 flex min-h-[49px] items-center gap-1 border-t px-3"
            >
                {aiAccounts.length === 0 ? (
                    <p className="min-w-0 flex-1 px-2 text-sm text-muted-foreground">
                        Chưa kết nối AI nào.
                    </p>
                ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-sm">
                        <AssistantAvatar {...assistant} className="size-7" />
                        <span className="min-w-0 flex-1 leading-tight">
                            <span className="block truncate">
                                {assistant.name || 'Trợ lý AI'}
                            </span>
                            {account && (
                                <span className="block truncate text-xs text-muted-foreground">
                                    {[
                                        account.name,
                                        vendorShortName(account.vendor),
                                    ].join(' · ')}
                                </span>
                            )}
                        </span>
                        {account && (
                            <>
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        'size-2 shrink-0 rounded-full',
                                        account.status === 'connected'
                                            ? 'bg-green-500'
                                            : account.status === 'error'
                                              ? 'bg-destructive'
                                              : 'bg-muted-foreground/40',
                                    )}
                                />
                                <span className="sr-only">
                                    {STATUS_LABELS[account.status] ??
                                        account.status}
                                </span>
                            </>
                        )}
                    </div>
                )}
                <RowActionsMenu
                    trigger={
                        // * Vertical dots for this footer only; the shared default stays horizontal.
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label="Mở menu cài đặt chat"
                        >
                            <MoreVertical
                                className="size-4"
                                aria-hidden="true"
                            />
                        </Button>
                    }
                    triggerLabel="Mở menu cài đặt chat"
                    items={[
                        {
                            label: 'Cài đặt chat',
                            icon: Settings,
                            onSelect: onOpenSettings,
                        },
                        {
                            label: 'Thống kê',
                            icon: ChartColumn,
                            onSelect: onOpenStats,
                        },
                    ]}
                />
            </section>
        </nav>
    );
});
