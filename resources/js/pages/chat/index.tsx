import { Head, router } from '@inertiajs/react';
import { MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { index } from '@/actions/App/Http/Controllers/ChatController';
import { ChatThreadPane } from '@/components/chat/chat-thread-pane';
import { ConversationList } from '@/components/chat/conversation-list';
import { RealtimeStatusIndicator } from '@/components/chat/realtime-status';
import { useDebounce } from '@/hooks/use-debounce';
import { useLiveReload } from '@/hooks/use-live-reload';
import type { ChatFilter, ChatPageProps, Conversation } from '@/types';

// * Props a partial reload refreshes; `navigation` carries the sidebar unread badge.
const LIVE_PROPS = [
    'conversations',
    'activeConversation',
    'messages',
    'channel',
    'channels',
    'unreadTotal',
    'navigation',
];
const BACK_PROPS = [...LIVE_PROPS, 'filters'];

export default function ChatIndex({
    conversations,
    activeConversation,
    messages,
    filters,
    channel,
    channels,
    canReply,
    canReconnect,
}: ChatPageProps) {
    const [search, setSearch] = useState(filters.q);
    const debouncedSearch = useDebounce(search, 300);

    const activeId = activeConversation?.id ?? null;

    const navigate = useCallback(
        (
            query: { c?: string | null; filter: ChatFilter; q: string },
            replace: boolean,
        ) => {
            router.get(
                index.url({
                    query: {
                        ...(query.c ? { c: query.c } : {}),
                        ...(query.filter !== 'all'
                            ? { filter: query.filter }
                            : {}),
                        ...(query.q !== '' ? { q: query.q } : {}),
                    },
                }),
                {},
                {
                    preserveState: true,
                    preserveScroll: true,
                    replace,
                    only: BACK_PROPS,
                },
            );
        },
        [],
    );

    // * Search is applied server-side after the user pauses typing.
    useEffect(() => {
        if (debouncedSearch !== filters.q) {
            navigate(
                { c: activeId, filter: filters.filter, q: debouncedSearch },
                true,
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only a changed search term should navigate
    }, [debouncedSearch]);

    const { status: realtimeStatus, setSending } = useLiveReload({
        only: LIVE_PROPS,
    });

    const selectConversation = (conversation: Conversation) =>
        navigate(
            { c: conversation.id, filter: filters.filter, q: filters.q },
            false,
        );

    const clearFilters = () => {
        setSearch('');
        navigate({ c: activeId, filter: 'all', q: '' }, true);
    };

    return (
        <>
            <Head title="Chat" />
            <div className="flex min-h-0 flex-1">
                <section
                    aria-label="Hội thoại"
                    className={`min-h-0 w-full flex-col border-r lg:flex lg:w-80 lg:shrink-0 ${activeConversation ? 'hidden' : 'flex'}`}
                >
                    <RealtimeStatusIndicator status={realtimeStatus} />
                    <ConversationList
                        conversations={conversations}
                        activeId={activeId}
                        search={search}
                        filter={filters.filter}
                        channels={channels}
                        onSearch={setSearch}
                        onFilter={(filter) =>
                            navigate(
                                { c: activeId, filter, q: filters.q },
                                true,
                            )
                        }
                        onSelect={selectConversation}
                        onClear={clearFilters}
                        canSyncZalo={
                            canReconnect && channels.zalo?.connected === true
                        }
                    />
                </section>

                <section
                    aria-label="Khung chat"
                    className={`min-h-0 min-w-0 flex-1 flex-col lg:flex ${activeConversation ? 'flex' : 'hidden'}`}
                >
                    {activeConversation === null ? (
                        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                            <MessageSquare
                                aria-hidden="true"
                                className="size-8"
                            />
                            <p className="text-sm">Chọn một hội thoại</p>
                        </div>
                    ) : (
                        <ChatThreadPane
                            key={activeConversation.id}
                            conversation={activeConversation}
                            messages={messages}
                            channel={channel}
                            canReply={canReply}
                            canReconnect={canReconnect}
                            backHref={index.url({
                                query:
                                    filters.filter !== 'all'
                                        ? { filter: filters.filter }
                                        : {},
                            })}
                            backOnly={BACK_PROPS}
                            liveProps={LIVE_PROPS}
                            onSendingChange={setSending}
                        />
                    )}
                </section>
            </div>
        </>
    );
}
