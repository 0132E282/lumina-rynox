import {
    AlertCircle,
    Check,
    CircleHelp,
    Download,
    FileText,
    Play,
    Loader2,
} from 'lucide-react';
import { AudioMessage } from '@/components/chat/audio-message';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { formatSize } from '@/components/file-manager/format';
import { Bubble as BubbleShell, BubbleContent } from '@/components/ui/bubble';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useInitials } from '@/hooks/use-initials';
import { formatClock, formatFullDateTime, groupByDay } from '@/lib/chat';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/types';

type MessageThreadProps = {
    messages: ChatMessage[];
    hasMore: boolean;
    loadingOlder: boolean;
    channelName: string;
    /** * Name of the signed-in channel account: shown as the sender of our own messages. */
    accountName: string | null;
    /** * Customer profile picture and name (initials fallback), shown beside their messages in a 1-1 chat. */
    customerAvatarUrl: string | null;
    customerName: string;
    isGroup: boolean;
    canReply: boolean;
    /** * Id of the message whose resend is in flight, so its button is locked. */
    resendingId: number | null;
    /** * CSS `background` of the message area; null keeps the theme colour. */
    background?: string | null;
    onLoadOlder: () => void;
    onResend: (message: ChatMessage) => void;
};

const SENDER_LABEL = {
    customer: 'Khách',
    staff: 'Nhân viên',
    system: 'Hệ thống',
} as const;

function SendStatus({
    message,
    channelName,
    canReply,
    resending,
    onResend,
}: {
    message: ChatMessage;
    channelName: string;
    canReply: boolean;
    resending: boolean;
    onResend: (message: ChatMessage) => void;
}) {
    const status = message.send_status;

    if (status === null) {
        return null;
    }

    return (
        <span
            aria-live="polite"
            className="flex flex-wrap items-center justify-end gap-x-1.5 text-xs text-muted-foreground"
        >
            {status === 'sending' ? (
                <>
                    <Loader2
                        aria-hidden="true"
                        className="size-3 motion-safe:animate-spin"
                    />
                    Đang gửi…
                </>
            ) : null}
            {status === 'sent' ? (
                <>
                    <Check aria-hidden="true" className="size-3" />
                    Đã gửi
                </>
            ) : null}
            {status === 'unknown' ? (
                <>
                    <CircleHelp
                        aria-hidden="true"
                        className="size-3 text-amber-600"
                    />
                    <span
                        title={`Hết thời gian chờ, tin có thể đã gửi. Kiểm tra trên ${channelName} rồi gửi lại nếu cần.`}
                    >
                        Chưa chắc chắn
                    </span>
                    {canReply ? (
                        <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-xs"
                            disabled={resending}
                            onClick={() => onResend(message)}
                        >
                            Gửi lại
                        </Button>
                    ) : null}
                </>
            ) : null}
            {status === 'failed' ? (
                <>
                    <AlertCircle
                        aria-hidden="true"
                        className="size-3 text-destructive"
                    />
                    <span>
                        Gửi lỗi{message.error ? `: ${message.error}` : ''}
                    </span>
                    {canReply ? (
                        <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-xs"
                            disabled={resending}
                            onClick={() => onResend(message)}
                        >
                            Thử lại
                        </Button>
                    ) : null}
                </>
            ) : null}
        </span>
    );
}

const IMAGE_CLUSTER_GAP_MS = 2 * 60 * 1000;

const isFileLike = (message: ChatMessage) =>
    message.attachment !== null &&
    !message.attachment.is_audio &&
    message.send_status !== 'failed';

/** * Consecutive images/files from one sender, sent close together, collapse into one bubble (like Zalo); a caption closes it. */
function clusterMessages(messages: ChatMessage[]): ChatMessage[][] {
    const clusters: ChatMessage[][] = [];

    for (const message of messages) {
        const current = clusters[clusters.length - 1];
        const previous = current?.[current.length - 1];

        if (
            previous !== undefined &&
            isFileLike(previous) &&
            previous.body === '' &&
            isFileLike(message) &&
            previous.direction === message.direction &&
            previous.sender_type === message.sender_type &&
            previous.sender_name === message.sender_name &&
            previous.sent_at !== null &&
            message.sent_at !== null &&
            Math.abs(
                Date.parse(message.sent_at) - Date.parse(previous.sent_at),
            ) <= IMAGE_CLUSTER_GAP_MS
        ) {
            current.push(message);
        } else {
            clusters.push([message]);
        }
    }

    return clusters;
}

function DownloadButton({ url, name }: { url: string; name: string | null }) {
    return (
        <a
            href={url}
            download={name ?? undefined}
            aria-label="Tải xuống"
            title="Tải xuống"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-foreground hover:bg-muted"
        >
            <Download aria-hidden="true" className="size-4" />
        </a>
    );
}

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;

/** * Plain text with http(s) addresses turned into links; everything else stays escaped text. */
function LinkedText({ text }: { text: string }) {
    return text.split(URL_PATTERN).map((part, index) =>
        index % 2 === 1 ? (
            <a
                key={index}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
            >
                {part}
            </a>
        ) : (
            part
        ),
    );
}

function FileCard({
    attachment,
    video = false,
}: {
    attachment: NonNullable<ChatMessage['attachment']>;
    video?: boolean;
}) {
    const Icon = video ? Play : FileText;

    return (
        <div className="flex w-80 max-w-full flex-col gap-2 rounded-[14px] bg-primary/10 p-2 text-foreground">
            {video ? (
                <video
                    src={attachment.url}
                    controls
                    preload="metadata"
                    className="aspect-video w-full rounded-[10px] bg-black object-contain"
                />
            ) : null}
            <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">
                        {attachment.name ?? (video ? 'Video' : 'Tệp đính kèm')}
                    </span>
                    {attachment.size !== null ? (
                        <span className="text-xs text-muted-foreground">
                            {formatSize(attachment.size)}
                        </span>
                    ) : null}
                </span>
                <DownloadButton url={attachment.url} name={attachment.name} />
            </div>
        </div>
    );
}

function Bubble({
    cluster,
    channelName,
    accountName,
    customerAvatarUrl,
    customerName,
    isGroup,
    canReply,
    resending,
    onResend,
}: {
    cluster: ChatMessage[];
    channelName: string;
    accountName: string | null;
    customerAvatarUrl: string | null;
    customerName: string;
    isGroup: boolean;
    canReply: boolean;
    resending: boolean;
    onResend: (message: ChatMessage) => void;
}) {
    // * The last message carries the time and send status of the whole cluster.
    const message = cluster[cluster.length - 1];
    const images = cluster.filter((item) => item.attachment?.is_image);
    const files = cluster.filter(
        (item) =>
            item.attachment !== null &&
            !item.attachment.is_image &&
            !item.attachment.is_audio,
    );
    const mine = message.direction === 'out';
    const label = SENDER_LABEL[message.sender_type];
    const getInitials = useInitials();
    const showName = mine || isGroup || message.sender_name !== null;
    const senderName = mine
        ? (accountName ?? message.sender_name)
        : message.sender_name;
    const showAvatar = !mine && !isGroup && message.sender_type === 'customer';

    const time = message.sent_at ? (
        <time
            dateTime={message.sent_at}
            title={formatFullDateTime(message.sent_at)}
        >
            {formatClock(message.sent_at)}
        </time>
    ) : null;

    return (
        <li
            className={cn(
                'flex items-end gap-2 motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in',
                mine ? 'justify-end' : 'justify-start',
            )}
        >
            {showAvatar ? (
                <Avatar size="sm" className="self-start">
                    <AvatarImage src={customerAvatarUrl ?? undefined} alt="" />
                    <AvatarFallback aria-hidden="true">
                        {getInitials(customerName)}
                    </AvatarFallback>
                </Avatar>
            ) : null}
            <div
                className={cn(
                    'flex max-w-[80%] min-w-0 flex-col gap-1',
                    mine ? 'items-end' : 'items-start',
                )}
            >
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">
                        <span className="sr-only">{label}: </span>
                        {showName ? (senderName ?? label) : label}
                    </span>
                    {time}
                    {mine ? (
                        <SendStatus
                            message={message}
                            channelName={channelName}
                            canReply={canReply}
                            resending={resending}
                            onResend={onResend}
                        />
                    ) : null}
                </span>
                {images.length > 1 ? (
                    <div
                        className={cn(
                            'grid max-w-full gap-1',
                            images.length === 2 || images.length === 4
                                ? 'grid-cols-2'
                                : 'grid-cols-3',
                        )}
                    >
                        {images.map((item) =>
                            item.attachment ? (
                                <a
                                    key={item.id}
                                    href={item.attachment.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <img
                                        src={item.attachment.url}
                                        alt={`Ảnh từ ${senderName ?? label}`}
                                        loading="lazy"
                                        decoding="async"
                                        className="aspect-square size-32 rounded-[14px] object-cover"
                                    />
                                </a>
                            ) : null,
                        )}
                    </div>
                ) : images.length === 1 && images[0].attachment ? (
                    <div className="flex max-w-full items-end gap-2">
                        <a
                            href={images[0].attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0"
                        >
                            <img
                                src={images[0].attachment.url}
                                alt={`Ảnh từ ${senderName ?? label}`}
                                loading="lazy"
                                decoding="async"
                                width={images[0].attachment.width ?? undefined}
                                height={
                                    images[0].attachment.height ?? undefined
                                }
                                className="h-auto max-h-80 w-auto max-w-full rounded-[14px] object-contain"
                            />
                        </a>
                        <DownloadButton
                            url={images[0].attachment.url}
                            name={images[0].attachment.name}
                        />
                    </div>
                ) : null}
                {message.attachment?.is_audio ? (
                    <AudioMessage src={message.attachment.url} />
                ) : null}
                {files.map((item) =>
                    item.attachment ? (
                        <FileCard
                            key={item.id}
                            attachment={item.attachment}
                            video={item.attachment.is_video}
                        />
                    ) : null,
                )}
                {message.body !== '' ? (
                    /* * Plain text only: React escapes it, `whitespace-pre-wrap` keeps the line breaks. */
                    <BubbleShell
                        align={mine ? 'end' : 'start'}
                        className="max-w-full"
                    >
                        <BubbleContent className="rounded-[18px] px-3.5 py-1.5 whitespace-pre-wrap">
                            <LinkedText text={message.body} />
                        </BubbleContent>
                    </BubbleShell>
                ) : null}
            </div>
        </li>
    );
}

export function MessageThread({
    messages,
    hasMore,
    loadingOlder,
    channelName,
    accountName,
    customerAvatarUrl,
    customerName,
    isGroup,
    canReply,
    resendingId,
    background = null,
    onLoadOlder,
    onResend,
}: MessageThreadProps) {
    const scroller = useRef<HTMLDivElement>(null);
    const previousHeight = useRef(0);
    const lastId = useRef<number | null>(null);
    const firstId = useRef<number | null>(null);
    const groups = useMemo(() => groupByDay(messages), [messages]);

    useLayoutEffect(() => {
        const element = scroller.current;

        if (element === null) {
            return;
        }

        const newestId = messages[messages.length - 1]?.id ?? null;
        const oldestId = messages[0]?.id ?? null;

        if (
            firstId.current !== null &&
            oldestId !== null &&
            oldestId < firstId.current
        ) {
            // * Older messages were prepended: keep the reader where they were.
            element.scrollTop += element.scrollHeight - previousHeight.current;
        } else if (newestId !== lastId.current) {
            // * Reduced motion is respected by never animating the scroll.
            element.scrollTop = element.scrollHeight;
        }

        previousHeight.current = element.scrollHeight;
        lastId.current = newestId;
        firstId.current = oldestId;
    }, [messages]);

    return (
        <div
            ref={scroller}
            style={background === null ? undefined : { background }}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        >
            {hasMore ? (
                <div className="flex justify-center pb-3">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={loadingOlder}
                        onClick={() => {
                            previousHeight.current =
                                scroller.current?.scrollHeight ?? 0;
                            onLoadOlder();
                        }}
                    >
                        {loadingOlder ? 'Đang tải…' : 'Tải tin cũ hơn'}
                    </Button>
                </div>
            ) : null}
            <div
                role="log"
                aria-label="Tin nhắn"
                aria-live={loadingOlder ? 'off' : 'polite'}
                aria-relevant="additions"
                className="flex flex-col gap-4"
            >
                {messages.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                        Chưa có tin nhắn.
                    </p>
                ) : null}
                {groups.map((group) => (
                    <section
                        key={group.key}
                        aria-label={group.heading}
                        className="flex flex-col gap-4"
                    >
                        <h3 className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
                            <span
                                aria-hidden="true"
                                className="h-px flex-1 bg-border"
                            />
                            {group.heading}
                            <span
                                aria-hidden="true"
                                className="h-px flex-1 bg-border"
                            />
                        </h3>
                        <ul className="flex flex-col gap-4">
                            {clusterMessages(group.messages).map((cluster) => (
                                <Bubble
                                    key={cluster[0].id}
                                    cluster={cluster}
                                    channelName={channelName}
                                    accountName={accountName}
                                    customerAvatarUrl={customerAvatarUrl}
                                    customerName={customerName}
                                    isGroup={isGroup}
                                    canReply={canReply}
                                    resending={
                                        resendingId ===
                                        cluster[cluster.length - 1].id
                                    }
                                    onResend={onResend}
                                />
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}
