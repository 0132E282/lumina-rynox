import { Link, router, usePage } from '@inertiajs/react';
import { ArrowLeft, PanelRight, Pin, PinOff, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
    messages as messagesRoute,
    pin,
    resend,
    send,
    sendAttachment,
} from '@/actions/App/Http/Controllers/ChatController';
import { AutoReplySwitch } from '@/components/chat/auto-reply-switch';
import { ChannelBadge } from '@/components/chat/channel-badge';
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerTitle,
} from '@/components/ui/drawer';
import { Composer } from '@/components/chat/composer';
import { useChatBackground } from '@/hooks/use-chat-background';
import { InfoPanel } from '@/components/chat/info-panel';
import { MessageThread } from '@/components/chat/message-thread';
import { useConfirm } from '@/components/confirm-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useInitials } from '@/hooks/use-initials';
import { api } from '@/lib/api';
import { mergeMessages } from '@/lib/chat';
import type {
    ChatChannel,
    ChatMessage,
    Conversation,
    MessagePage,
} from '@/types';

type ChatThreadPaneProps = {
    conversation: Conversation;
    messages: MessagePage;
    channel: ChatChannel;
    canReply: boolean;
    canReconnect: boolean;
    /** * Mobile "back to the list" link target and the props its visit refreshes. */
    backHref: string;
    backOnly: string[];
    /** * Props a send/resend refreshes (plus `errors`). */
    liveProps: string[];
    /** * Tells the page a send is running, so live reloads wait for it. */
    onSendingChange: (sending: boolean) => void;
};

/** * The open conversation of the chat screens: header, offline banner, messages, composer and contact panel. Mount it with `key={conversation.id}`. */
export function ChatThreadPane({
    conversation,
    messages,
    channel,
    canReply,
    canReconnect,
    backHref,
    backOnly,
    liveProps,
    onSendingChange,
}: ChatThreadPaneProps) {
    const confirm = useConfirm();
    // * The profile panel on the right stays closed until the header button opens it.
    const [infoOpen, setInfoOpen] = useState(false);
    const getInitials = useInitials();
    const errors = usePage().props.errors as Record<string, string> | undefined;
    const [draft, setDraft] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    // * One token per file, kept across retries so the backend sends each file once.
    const fileTokens = useRef(new Map<File, string>());
    const [pendingBody, setPendingBody] = useState<string | null>(null);
    const [resendingId, setResendingId] = useState<number | null>(null);
    // * Same token across retries of one submit, so the backend sends it once even if the request is repeated.
    const tokenRef = useRef<string | null>(null);
    const conversationId = conversation.id;
    const [background] = useChatBackground(conversationId);

    useEffect(() => {
        onSendingChange(pendingBody !== null);
    }, [pendingBody, onSendingChange]);

    // * Older pages are fetched on demand and merged with the live page.
    const [older, setOlder] = useState<MessagePage>({
        data: [],
        has_more: false,
    });
    const [loadingOlder, setLoadingOlder] = useState(false);

    const allMessages = useMemo(() => {
        const merged = mergeMessages(older.data, messages.data);

        if (pendingBody === null) {
            return merged;
        }

        const optimistic: ChatMessage = {
            id: Number.MAX_SAFE_INTEGER,
            direction: 'out',
            sender_type: 'staff',
            sender_name: null,
            body: pendingBody,
            attachment: null,
            send_status: 'sending',
            error: null,
            sent_at: new Date().toISOString(),
        };

        return [...merged, optimistic];
    }, [older.data, messages.data, pendingBody]);

    const hasMore = older.data.length > 0 ? older.has_more : messages.has_more;

    const loadOlder = () => {
        if (loadingOlder) {
            return;
        }

        const oldest = allMessages[0]?.id;

        if (oldest === undefined) {
            return;
        }

        setLoadingOlder(true);
        api.get<MessagePage>(
            messagesRoute.url({ conversation: conversationId }),
            { params: { before: oldest } },
        )
            .then(({ data }) =>
                setOlder({
                    data: mergeMessages(older.data, data.data),
                    has_more: data.has_more,
                }),
            )
            .finally(() => setLoadingOlder(false));
    };

    const togglePin = () =>
        router.put(
            pin.url({ conversation: conversationId }),
            { pinned: !conversation.pinned },
            { preserveScroll: true, preserveState: true, only: liveProps },
        );

    // * The backend takes one file per request. Several files go out together (in parallel); the caption rides with the last one.
    const postFiles = async (queue: File[], caption: string) => {
        const results = await Promise.allSettled(
            queue.map((file, index) => {
                const token =
                    fileTokens.current.get(file) ?? crypto.randomUUID();
                const data = new FormData();

                fileTokens.current.set(file, token);
                data.append('file', file);
                data.append('body', index === queue.length - 1 ? caption : '');
                data.append('client_token', token);

                return api.post(
                    sendAttachment.url({ conversation: conversationId }),
                    data,
                );
            }),
        );
        const failed = queue.filter(
            (_, index) => results[index].status === 'rejected',
        );

        queue.forEach((file) => {
            if (!failed.includes(file)) {
                fileTokens.current.delete(file);
            }
        });
        setFiles(failed);

        if (failed.length === 0) {
            setDraft('');
        } else {
            toast.error(
                `${failed.length}/${queue.length} tệp gửi lỗi, bấm gửi để thử lại.`,
            );
        }

        router.reload({ only: [...liveProps, 'errors'] });
        setPendingBody(null);
    };

    const submit = () => {
        if (pendingBody !== null) {
            return;
        }

        const body = draft.trim();

        if (files.length > 0) {
            setPendingBody(
                body === ''
                    ? `📎 ${files[0].name}${files.length > 1 ? ` (+${files.length - 1})` : ''}`
                    : body,
            );
            void postFiles(files, body);

            return;
        }

        tokenRef.current ??= crypto.randomUUID();
        setPendingBody(body);
        router.post(
            send.url({ conversation: conversationId }),
            { body, client_token: tokenRef.current },
            {
                preserveScroll: true,
                preserveState: true,
                only: [...liveProps, 'errors'],
                onSuccess: () => {
                    setDraft('');
                    tokenRef.current = null;
                },
                onFinish: () => setPendingBody(null),
            },
        );
    };

    const resendMessage = async (message: ChatMessage) => {
        if (resendingId !== null) {
            return;
        }

        // * An `unknown` message may already be on the channel, so the user must accept the duplicate risk.
        if (
            message.send_status === 'unknown' &&
            !(await confirm({
                title: 'Gửi lại tin nhắn?',
                description: `Có thể gửi trùng: tin trước đó có thể đã tới ${channel.name}. Chỉ gửi lại nếu bạn đã kiểm tra.`,
                confirmLabel: 'Gửi lại',
            }))
        ) {
            return;
        }

        setResendingId(message.id);
        router.post(
            resend.url({ message: message.id }),
            {},
            {
                preserveScroll: true,
                preserveState: true,
                only: [...liveProps, 'errors'],
                onFinish: () => setResendingId(null),
            },
        );
    };

    const composerDisabled =
        !canReply || !channel.connected || !channel.can_send;
    const disabledReason = !channel.connected
        ? 'Mất kết nối, kết nối lại để gửi'
        : !channel.can_send
          ? `Quyền gửi tin ${channel.name} đang tắt`
          : 'Bạn không có quyền trả lời';

    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                            only={backOnly}
                            aria-label="Quay lại danh sách hội thoại"
                        >
                            <ArrowLeft aria-hidden="true" />
                        </Link>
                    </Button>
                    <span className="relative shrink-0">
                        <Avatar>
                            <AvatarImage
                                src={conversation.avatar_url ?? undefined}
                                alt=""
                            />
                            <AvatarFallback aria-hidden="true">
                                {getInitials(conversation.title)}
                            </AvatarFallback>
                        </Avatar>
                        <ChannelBadge
                            provider={conversation.provider}
                            className="absolute -right-1 -bottom-1"
                        />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-semibold">
                            {conversation.title}
                        </h2>
                        <p className="truncate text-xs text-muted-foreground">
                            {channel.name}
                            {(channel.display_name ??
                            channel.bot_username ??
                            conversation.account?.name ??
                            channel.account)
                                ? ` · ${channel.display_name ?? channel.bot_username ?? conversation.account?.name ?? channel.account}`
                                : ''}
                            {conversation.username
                                ? ` · @${conversation.username}`
                                : ''}
                        </p>
                    </div>
                    <AutoReplySwitch />
                    {canReply ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-pressed={conversation.pinned}
                            aria-label={
                                conversation.pinned
                                    ? 'Bỏ ghim'
                                    : 'Ghim hội thoại'
                            }
                            title={
                                conversation.pinned
                                    ? 'Bỏ ghim'
                                    : 'Ghim hội thoại'
                            }
                            onClick={togglePin}
                        >
                            {conversation.pinned ? (
                                <PinOff aria-hidden="true" />
                            ) : (
                                <Pin aria-hidden="true" />
                            )}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Thông tin hội thoại"
                        aria-expanded={infoOpen}
                        title="Thông tin hội thoại"
                        onClick={() => setInfoOpen((open) => !open)}
                    >
                        <PanelRight aria-hidden="true" />
                    </Button>
                </header>

                {channel.connected ? null : (
                    <div
                        role="alert"
                        className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-foreground"
                    >
                        <span className="flex items-center gap-2">
                            <WifiOff
                                aria-hidden="true"
                                className="size-4 text-destructive"
                            />
                            Mất kết nối {channel.name}
                            {channel.last_error
                                ? `: ${channel.last_error}`
                                : '.'}{' '}
                            Không nhận và không gửi được tin.
                        </span>
                        {canReconnect ? (
                            <Button asChild size="sm" variant="outline">
                                <Link
                                    href={`/integrations/${channel.provider}`}
                                >
                                    Kết nối lại
                                </Link>
                            </Button>
                        ) : null}
                    </div>
                )}

                <MessageThread
                    messages={allMessages}
                    hasMore={hasMore}
                    loadingOlder={loadingOlder}
                    channelName={channel.name}
                    accountName={conversation.account?.name ?? channel.account}
                    customerAvatarUrl={conversation.avatar_url}
                    customerName={conversation.title}
                    isGroup={conversation.type === 'group'}
                    canReply={canReply && channel.connected}
                    resendingId={resendingId}
                    background={background}
                    onLoadOlder={loadOlder}
                    onResend={resendMessage}
                />

                <Composer
                    value={draft}
                    onChange={setDraft}
                    onSubmit={submit}
                    sending={pendingBody !== null}
                    disabled={composerDisabled}
                    disabledReason={disabledReason}
                    error={errors?.body ?? errors?.file}
                    files={files}
                    onFilesChange={setFiles}
                    canRecord={channel.provider === 'messenger'}
                />
            </div>
            {/* * Conversation profile: a drawer sliding in from the right. */}
            <Drawer
                direction="right"
                open={infoOpen}
                onOpenChange={setInfoOpen}
            >
                <DrawerContent className="data-[vaul-drawer-direction=right]:w-80 data-[vaul-drawer-direction=right]:sm:max-w-80">
                    <DrawerTitle className="sr-only">
                        Thông tin hội thoại
                    </DrawerTitle>
                    <DrawerDescription className="sr-only">
                        Hồ sơ khách, ảnh nền và tệp của hội thoại.
                    </DrawerDescription>
                    <InfoPanel conversation={conversation} channel={channel} />
                </DrawerContent>
            </Drawer>
        </div>
    );
}
