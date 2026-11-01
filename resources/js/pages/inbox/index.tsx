import { Head, Link, router } from '@inertiajs/react';
import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    MessageSquare,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { index as inboxIndex } from '@/actions/App/Http/Controllers/InboxController';
import { markUnread } from '@/actions/App/Http/Controllers/MailController';
import { ChatThreadPane } from '@/components/chat/chat-thread-pane';
import { ConversationList } from '@/components/chat/conversation-list';
import { RealtimeStatusIndicator } from '@/components/chat/realtime-status';
import { MailThreadContent } from '@/components/mail/mail-thread-content';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebounce } from '@/hooks/use-debounce';
import { useLiveReload } from '@/hooks/use-live-reload';
import type {
    ChatChannel,
    ChatFilter,
    InboxItem,
    InboxPageProps,
} from '@/types';

const ALL_CHANNELS = 'all';

// * Shown in the list like a chat channel: mail has no connection banner of its own (mailbox errors live on the mail accounts page).
const EMAIL_CHANNEL: ChatChannel = {
    provider: 'email',
    name: 'Email',
    status: 'connected',
    connected: true,
    last_error: null,
    display_name: null,
    bot_username: null,
    account: null,
    account_count: 0,
    can_send: true,
};

// * Props a partial reload refreshes; `navigation` carries the sidebar unread badge.
const LIST_PROPS = ['items', 'channelTabs', 'channels', 'navigation'];
const CHAT_PROPS = [...LIST_PROPS, 'activeConversation', 'messages', 'channel'];
// * A visit to another item or filter also swaps the open thread.
const VISIT_PROPS = [...CHAT_PROPS, 'filters', 'mailThread', 'activeMailId'];

type InboxQuery = {
    channel: string;
    filter: ChatFilter;
    q: string;
    c?: string | null;
    m?: number | null;
    page?: number;
};

export default function InboxIndex({
    items,
    channelTabs,
    filters,
    channels,
    activeConversation,
    messages,
    channel,
    mailThread,
    activeMailId,
    can,
}: InboxPageProps) {
    const [search, setSearch] = useState(filters.q);
    const debouncedSearch = useDebounce(search, 300);
    const activeConversationId = activeConversation?.id ?? null;
    const hasActive = activeConversation !== null || mailThread !== null;
    const liveProps = activeConversation === null ? LIST_PROPS : CHAT_PROPS;

    const navigate = useCallback((query: InboxQuery, replace: boolean) => {
        router.get(
            inboxIndex.url({
                query: {
                    ...(query.channel !== ALL_CHANNELS
                        ? { channel: query.channel }
                        : {}),
                    ...(query.filter !== 'all' ? { filter: query.filter } : {}),
                    ...(query.q !== '' ? { q: query.q } : {}),
                    ...(query.c ? { c: query.c } : {}),
                    ...(query.m ? { m: query.m } : {}),
                    ...(query.page && query.page > 1
                        ? { page: query.page }
                        : {}),
                },
            }),
            {},
            {
                preserveState: true,
                preserveScroll: true,
                replace,
                only: VISIT_PROPS,
            },
        );
    }, []);

    const current = (overrides: Partial<InboxQuery> = {}): InboxQuery => ({
        channel: filters.channel,
        filter: filters.filter,
        q: filters.q,
        c: activeConversationId,
        m: activeMailId,
        page: items.current_page,
        ...overrides,
    });

    // * Search is applied server-side after the user pauses typing.
    useEffect(() => {
        if (debouncedSearch !== filters.q) {
            navigate(current({ q: debouncedSearch, page: 1 }), true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only a changed search term should navigate
    }, [debouncedSearch]);

    const { status: realtimeStatus, setSending } = useLiveReload({
        only: liveProps,
        chat: can.chat,
        mail: can.mail,
    });

    const allChannels = useMemo(
        () => ({ ...channels, email: EMAIL_CHANNEL }),
        [channels],
    );

    const selectItem = (item: InboxItem) =>
        navigate(
            current({
                c: item.kind === 'chat' ? String(item.id) : null,
                m: item.kind === 'mail' ? Number(item.id) : null,
            }),
            false,
        );

    const clearFilters = () => {
        setSearch('');
        navigate(
            current({ channel: ALL_CHANNELS, filter: 'all', q: '', page: 1 }),
            true,
        );
    };

    const backHref = inboxIndex.url({
        query: {
            ...(filters.channel !== ALL_CHANNELS
                ? { channel: filters.channel }
                : {}),
            ...(filters.filter !== 'all' ? { filter: filters.filter } : {}),
            ...(filters.q !== '' ? { q: filters.q } : {}),
            ...(items.current_page > 1 ? { page: items.current_page } : {}),
        },
    });

    const tabs = [
        { key: ALL_CHANNELS, label: 'Tất cả', unread: 0 },
        ...channelTabs,
    ];

    // * The channel tabs scroll sideways without a scrollbar; keep the selected one fully in view.
    const tabListRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const list = tabListRef.current;
        const active = list?.querySelector<HTMLElement>('[data-state=active]');

        if (!list || !active) {
            return;
        }

        const { offsetLeft, offsetWidth } = active;
        list.scrollTo({
            left: offsetLeft - (list.clientWidth - offsetWidth) / 2,
            behavior: 'smooth',
        });
    }, [filters.channel]);

    return (
        <>
            <Head title="Hộp thư chung" />
            <div className="flex min-h-0 flex-1">
                <section
                    aria-label="Hội thoại"
                    className={`min-h-0 w-full flex-col border-r lg:flex lg:w-96 lg:shrink-0 ${hasActive ? 'hidden' : 'flex'}`}
                >
                    <RealtimeStatusIndicator status={realtimeStatus} />
                    <ConversationList
                        conversations={items.data}
                        activeId={null}
                        isActive={(item) =>
                            item.kind === 'chat'
                                ? item.id === activeConversationId
                                : item.id === activeMailId
                        }
                        search={search}
                        filter={filters.filter}
                        channels={allChannels}
                        onSearch={setSearch}
                        onSelect={selectItem}
                        onClear={clearFilters}
                        canSyncZalo={
                            can.reconnect && channels.zalo?.connected === true
                        }
                        toolbar={
                            <Tabs
                                value={filters.channel}
                                onValueChange={(channel) =>
                                    navigate(
                                        current({ channel, page: 1 }),
                                        true,
                                    )
                                }
                            >
                                <TabsList
                                    ref={tabListRef}
                                    variant="line"
                                    aria-label="Lọc theo kênh"
                                    className="w-full [scrollbar-width:none] justify-start overflow-x-auto px-1 pb-2 group-data-[orientation=horizontal]/tabs:h-11 [&::-webkit-scrollbar]:hidden"
                                >
                                    {tabs.map((tab) => (
                                        <TabsTrigger
                                            key={tab.key}
                                            value={tab.key}
                                            className="flex-none px-3"
                                        >
                                            {tab.label}
                                            {tab.unread > 0 && (
                                                <span
                                                    aria-label={`${tab.unread} tin chưa đọc`}
                                                    className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs leading-5 font-medium text-white"
                                                >
                                                    {tab.unread > 99
                                                        ? '99+'
                                                        : tab.unread}
                                                </span>
                                            )}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>
                        }
                        footer={
                            items.last_page > 1 ? (
                                <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-sm text-muted-foreground">
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        aria-label="Trang trước"
                                        disabled={items.current_page <= 1}
                                        onClick={() =>
                                            navigate(
                                                current({
                                                    page:
                                                        items.current_page - 1,
                                                }),
                                                true,
                                            )
                                        }
                                    >
                                        <ChevronLeft aria-hidden="true" />
                                    </Button>
                                    <span>
                                        Trang {items.current_page}/
                                        {items.last_page}
                                    </span>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        aria-label="Trang sau"
                                        disabled={
                                            items.current_page >=
                                            items.last_page
                                        }
                                        onClick={() =>
                                            navigate(
                                                current({
                                                    page:
                                                        items.current_page + 1,
                                                }),
                                                true,
                                            )
                                        }
                                    >
                                        <ChevronRight aria-hidden="true" />
                                    </Button>
                                </div>
                            ) : null
                        }
                    />
                </section>

                <section
                    aria-label="Khung hội thoại"
                    className={`min-h-0 min-w-0 flex-1 flex-col lg:flex ${hasActive ? 'flex' : 'hidden'}`}
                >
                    {activeConversation !== null && channel !== null ? (
                        <ChatThreadPane
                            key={`chat:${activeConversation.id}`}
                            conversation={activeConversation}
                            messages={messages}
                            channel={channel}
                            canReply={can.reply}
                            canReconnect={can.reconnect}
                            backHref={backHref}
                            backOnly={VISIT_PROPS}
                            liveProps={CHAT_PROPS}
                            onSendingChange={setSending}
                        />
                    ) : mailThread !== null ? (
                        <div
                            key={`mail:${mailThread.message.id}`}
                            className="flex min-h-0 flex-1 flex-col"
                        >
                            <header className="flex items-center gap-3 border-b px-4 py-3">
                                <Button
                                    asChild
                                    variant="ghost"
                                    size="icon"
                                    className="lg:hidden"
                                >
                                    <Link
                                        href={backHref}
                                        preserveState
                                        only={VISIT_PROPS}
                                        aria-label="Quay lại danh sách hội thoại"
                                    >
                                        <ArrowLeft aria-hidden="true" />
                                    </Link>
                                </Button>
                                <div className="min-w-0 flex-1">
                                    <h2 className="truncate text-sm font-semibold">
                                        {mailThread.message.subject ||
                                            '(Không có tiêu đề)'}
                                    </h2>
                                    <p className="truncate text-xs text-muted-foreground">
                                        Email · {mailThread.mailbox.email}
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                        router.post(
                                            markUnread.url({
                                                message: mailThread.message.id,
                                            }),
                                            { from_inbox: true },
                                        )
                                    }
                                >
                                    Đánh dấu chưa đọc
                                </Button>
                            </header>
                            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                                <MailThreadContent
                                    thread={mailThread.thread}
                                    outbox={mailThread.outbox}
                                    mailbox={mailThread.mailbox}
                                    reply_defaults={mailThread.reply_defaults}
                                    show_images={mailThread.show_images}
                                    can={mailThread.can}
                                    messageId={mailThread.message.id}
                                    fromInbox
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                            <MessageSquare
                                aria-hidden="true"
                                className="size-8"
                            />
                            <p className="text-sm">Chọn một hội thoại</p>
                        </div>
                    )}
                </section>
            </div>
        </>
    );
}
