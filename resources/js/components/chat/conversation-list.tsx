import { Link } from '@inertiajs/react';
import { Pin, Search, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { show } from '@/actions/App/Http/Controllers/IntegrationController';
import { useInitials } from '@/hooks/use-initials';
import { formatListTime } from '@/lib/chat';
import { cn } from '@/lib/utils';
import type { ChatChannel, ChatFilter, Conversation } from '@/types';
import { ChannelBadge } from './channel-badge';

const FILTERS: { value: ChatFilter; label: string }[] = [
    { value: 'all', label: 'Tất cả' },
    { value: 'unread', label: 'Chưa đọc' },
];

/** * Chat rows have a UUID id; the inbox also lists mail rows, which keep their numeric id. */
type ConversationListItem = Omit<Conversation, 'id'> & {
    id: string | number;
};

type ConversationListProps<T extends ConversationListItem> = {
    conversations: T[];
    activeId: string | null;
    /** * Identifies the open row when ids alone are ambiguous (the inbox mixes chat and mail); defaults to comparing `activeId`. */
    isActive?: (conversation: T) => boolean;
    /** * Extra controls under the filter buttons (the inbox channel tabs). */
    toolbar?: ReactNode;
    /** * Rendered after the rows (the inbox pager). */
    footer?: ReactNode;
    search: string;
    filter: ChatFilter;
    /** * Per provider; an item shows the "Mất kết nối" chip when its channel is not connected. */
    channels: Record<string, ChatChannel>;
    onSearch: (value: string) => void;
    /** * Omit to hide the "Tất cả" / "Chưa đọc" buttons (the inbox has none). */
    onFilter?: (value: ChatFilter) => void;
    onSelect: (conversation: T) => void;
    onClear: () => void;
    /** * Shown in the empty state when Zalo is connected: links to the Zalo page, where each account syncs its own friends and groups. */
    canSyncZalo?: boolean;
};

function previewText(conversation: ConversationListItem): string {
    const text = conversation.last_message_preview ?? 'Chưa có tin nhắn';

    return conversation.last_message_direction === 'out'
        ? `Bạn: ${text}`
        : text;
}

export function ConversationList<T extends ConversationListItem>({
    conversations,
    activeId,
    isActive,
    toolbar,
    footer,
    search,
    filter,
    channels,
    onSearch,
    onFilter,
    onSelect,
    onClear,
    canSyncZalo = false,
}: ConversationListProps<T>) {
    const getInitials = useInitials();
    const isFiltered = filter !== 'all' || search !== '';

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-col gap-3 border-b p-4">
                <div className="relative">
                    <Search
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        type="search"
                        value={search}
                        onChange={(event) => onSearch(event.target.value)}
                        placeholder="Tìm hội thoại…"
                        aria-label="Tìm hội thoại"
                        maxLength={100}
                        className="pl-9"
                    />
                </div>
                {onFilter ? (
                    <div
                        role="group"
                        aria-label="Lọc hội thoại"
                        className="flex gap-2"
                    >
                        {FILTERS.map((option) => (
                            <Button
                                key={option.value}
                                type="button"
                                size="sm"
                                variant={
                                    filter === option.value
                                        ? 'secondary'
                                        : 'outline'
                                }
                                aria-pressed={filter === option.value}
                                onClick={() => onFilter(option.value)}
                            >
                                {option.label}
                            </Button>
                        ))}
                    </div>
                ) : null}
                {toolbar}
            </div>

            <nav
                aria-label="Danh sách hội thoại"
                className="min-h-0 flex-1 overflow-y-auto"
            >
                {conversations.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
                        <p>
                            {isFiltered
                                ? 'Không tìm thấy hội thoại nào.'
                                : 'Chưa có hội thoại. Tin nhắn đến từ Telegram hoặc Zalo sẽ hiện ở đây.'}
                        </p>
                        {!isFiltered && canSyncZalo ? (
                            <Button
                                asChild
                                type="button"
                                size="sm"
                                variant="outline"
                            >
                                <Link href={show.url({ provider: 'zalo' })}>
                                    Đồng bộ danh bạ Zalo
                                </Link>
                            </Button>
                        ) : null}
                        {isFiltered ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={onClear}
                            >
                                Xoá bộ lọc
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <ul>
                        {conversations.map((conversation) => {
                            const selected = isActive
                                ? isActive(conversation)
                                : conversation.id === activeId;
                            const time = conversation.last_message_at
                                ? formatListTime(conversation.last_message_at)
                                : '';
                            const unread = conversation.unread_count;
                            const channel = channels[conversation.provider];
                            const channelName =
                                channel?.name ?? conversation.provider;
                            const connected = channel?.connected ?? false;

                            return (
                                <li key={conversation.key ?? conversation.id}>
                                    <button
                                        type="button"
                                        onClick={() => onSelect(conversation)}
                                        aria-current={
                                            selected ? 'true' : undefined
                                        }
                                        aria-label={[
                                            channelName,
                                            conversation.title,
                                            conversation.pinned
                                                ? 'đã ghim'
                                                : null,
                                            unread > 0
                                                ? `${unread} tin chưa đọc`
                                                : null,
                                            connected ? null : 'mất kết nối',
                                            time || null,
                                        ]
                                            .filter(Boolean)
                                            .join(', ')}
                                        className={cn(
                                            'flex min-h-16 w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none',
                                            selected && 'bg-accent',
                                        )}
                                    >
                                        <span className="relative shrink-0">
                                            <Avatar>
                                                <AvatarImage
                                                    src={
                                                        conversation.avatar_url ??
                                                        undefined
                                                    }
                                                    alt=""
                                                    loading="lazy"
                                                />
                                                <AvatarFallback aria-hidden="true">
                                                    {getInitials(
                                                        conversation.title,
                                                    )}
                                                </AvatarFallback>
                                            </Avatar>
                                            <ChannelBadge
                                                provider={conversation.provider}
                                                className="absolute -right-1 -bottom-1"
                                            />
                                        </span>
                                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <span className="flex items-baseline justify-between gap-2">
                                                <span className="flex min-w-0 items-center gap-1">
                                                    <span
                                                        className={cn(
                                                            'truncate text-sm',
                                                            unread > 0
                                                                ? 'font-semibold'
                                                                : 'font-medium',
                                                        )}
                                                    >
                                                        {conversation.title}
                                                    </span>
                                                    {conversation.pinned ? (
                                                        <Pin
                                                            role="img"
                                                            aria-label="Đã ghim"
                                                            className="size-3 shrink-0 text-muted-foreground"
                                                        />
                                                    ) : null}
                                                </span>
                                                <span className="shrink-0 text-xs text-muted-foreground">
                                                    {time}
                                                </span>
                                            </span>
                                            <span className="flex items-center justify-between gap-2">
                                                <span className="truncate text-sm text-muted-foreground">
                                                    {previewText(conversation)}
                                                </span>
                                                {unread > 0 ? (
                                                    <Badge
                                                        aria-hidden="true"
                                                        className="shrink-0"
                                                    >
                                                        {unread > 99
                                                            ? '99+'
                                                            : unread}
                                                    </Badge>
                                                ) : null}
                                            </span>
                                            {conversation.account &&
                                            (channel?.account_count ?? 0) >
                                                1 ? (
                                                <span className="flex w-fit max-w-full items-center gap-1 truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                                    <Avatar className="size-4">
                                                        <AvatarImage
                                                            src={
                                                                conversation
                                                                    .account
                                                                    .avatar_url ??
                                                                undefined
                                                            }
                                                            alt=""
                                                            loading="lazy"
                                                        />
                                                        <AvatarFallback
                                                            aria-hidden="true"
                                                            className="text-[8px]"
                                                        >
                                                            {getInitials(
                                                                conversation
                                                                    .account
                                                                    .name ?? '',
                                                            )}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <span className="truncate">
                                                        {conversation.account
                                                            .name ??
                                                            'Tài khoản'}
                                                    </span>
                                                </span>
                                            ) : null}
                                            {connected ? null : (
                                                <Badge
                                                    variant="destructive"
                                                    className="mt-1"
                                                >
                                                    <WifiOff aria-hidden="true" />
                                                    Mất kết nối
                                                </Badge>
                                            )}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </nav>
            {footer}
        </div>
    );
}
