import { Image as ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ProposalText } from '@/components/ai-chat/proposal-text';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { asksForImage } from '@/lib/image-request';
import { useInitials } from '@/hooks/use-initials';
import { ProposalCard } from '@/components/ai-chat/proposal-card';
import type { AiChatMessage, AiChatProposal } from '@/types';
import { cn } from '@/lib/utils';

/** * Persisted messages plus local ones (not yet saved user bubble, error line), which have string ids. */
export type ThreadItem = {
    id: number | string;
    role: AiChatMessage['role'] | 'error';
    content: string;
    proposals?: AiChatProposal[];
};

const THINKING_AFTER_SECONDS = 2;

/** * Real request state only (the backend is synchronous, no streaming): "sending" at first, then "thinking" with elapsed seconds. Mounted only while pending, so the timer restarts for each send. */
function PendingStatus({
    assistant,
    imageRequest,
}: {
    assistant?: AssistantIdentity;
    /** The last message asks for a picture: shows "Đang tạo ảnh…" (a hint only, the assistant answers with text or SVG). */
    imageRequest: boolean;
}) {
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            setSeconds(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);

        return () => window.clearInterval(timer);
    }, []);

    const thinking = seconds >= THINKING_AFTER_SECONDS;

    const name = assistant?.name || 'Trợ lý AI';

    // * Same row layout as an assistant message (avatar, name above), so the answer replaces it without a jump.
    return (
        <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2 self-start"
        >
            <AssistantAvatar {...assistant} className="hidden sm:flex" />
            <div className="min-w-0 text-sm leading-relaxed">
                <span
                    aria-hidden="true"
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                    {name}
                </span>
                <span className="sr-only">{name}: </span>
                {imageRequest && (
                    // * Placeholder frame for the picture: decorative, shimmers only without reduced motion.
                    <span
                        aria-hidden="true"
                        className="mb-2 flex size-24 items-center justify-center rounded-lg border border-dashed bg-muted/50 text-muted-foreground motion-safe:animate-pulse"
                    >
                        <ImageIcon className="size-6" />
                    </span>
                )}
                <span className="flex items-center gap-2 text-muted-foreground">
                    {/* * Typing dots: decorative, still when the person prefers reduced motion. */}
                    <span
                        aria-hidden="true"
                        className="flex items-center gap-1"
                    >
                        {[0, 150, 300].map((delay) => (
                            <span
                                key={delay}
                                style={{ animationDelay: `${delay}ms` }}
                                className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-bounce"
                            />
                        ))}
                    </span>
                    <span
                        className={cn(
                            imageRequest && 'motion-safe:animate-pulse',
                        )}
                    >
                        {imageRequest
                            ? 'Đang tạo ảnh…'
                            : thinking
                              ? 'Trợ lý đang suy nghĩ…'
                              : 'Đang gửi…'}
                    </span>
                    {(thinking || imageRequest) && (
                        <span className="tabular-nums">{seconds}s</span>
                    )}
                </span>
            </div>
        </div>
    );
}

/** * Small decorative avatars at the start of a message; hidden on very narrow screens. */
function UserAvatar({ name, avatar }: { name?: string; avatar?: string }) {
    const getInitials = useInitials();

    return (
        <Avatar aria-hidden="true" className="hidden size-7 sm:flex">
            <AvatarImage src={avatar} alt="" />
            <AvatarFallback className="bg-neutral-200 text-xs text-black dark:bg-neutral-700 dark:text-white">
                {getInitials(name ?? '')}
            </AvatarFallback>
        </Avatar>
    );
}

/** * Message thread: user bubble on the right, assistant text on the left. User/error content is plain text (line breaks kept); assistant content is markdown. Never raw HTML. */
export function ChatThread({
    items,
    pending,
    onProposalsChange,
    onOpenFile,
    onChoose,
    userName,
    userAvatar,
    assistant,
}: {
    items: ThreadItem[];
    pending: boolean;
    onProposalsChange: (
        id: number | string,
        proposals: AiChatProposal[],
    ) => void;
    /** Opens a file of an edit proposal in the code viewer; without it the file name is plain text. */
    onOpenFile?: (repo: string, path: string) => void;
    /** Sends a picked ```choices option as the next user message; without it the cards stay read-only. */
    onChoose?: (text: string) => void;
    /** Decorative avatars: the signed-in person's name/photo and the AI account's vendor. */
    userName?: string;
    userAvatar?: string;
    assistant?: AssistantIdentity;
}) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    // * Pinned to the bottom until the person scrolls up on purpose (within 80px of the end counts as the bottom).
    const stickRef = useRef(true);
    const previousCount = useRef(0);
    const wasPending = useRef(false);

    const scrollToBottom = () => {
        const scroller = scrollerRef.current;

        if (scroller) {
            scroller.scrollTop = scroller.scrollHeight;
        }
    };

    // * Only this scroller moves: `scrollIntoView` would also scroll the page layout around it.
    useEffect(() => {
        const last = items[items.length - 1];
        const sent =
            last?.role === 'user' && items.length > previousCount.current;
        const started = pending && !wasPending.current;

        if (previousCount.current === 0 || sent || started) {
            stickRef.current = true;
        }

        if (stickRef.current) {
            scrollToBottom();
        }

        previousCount.current = items.length;
        wasPending.current = pending;
    }, [items, pending]);

    // * Markdown, code blocks and the status line change height after render: follow them while pinned.
    useEffect(() => {
        const content = contentRef.current;

        if (!content) {
            return;
        }

        const observer = new ResizeObserver(() => {
            if (stickRef.current) {
                scrollToBottom();
            }
        });

        observer.observe(content);

        return () => observer.disconnect();
    }, []);

    const lastUser = [...items].reverse().find((item) => item.role === 'user');

    return (
        <div
            // * pt-12: the floating toolbar (terminal, GitHub, code) sits in the top corners; the thread scrolls below it, not under it.
            // * relative: the screen-reader-only spans inside are absolutely positioned; without a positioned scroller they would stretch the page behind it.
            className="relative flex min-h-0 flex-1 flex-col overflow-y-auto pt-12"
            aria-live="polite"
            ref={scrollerRef}
            onScroll={(event) => {
                const scroller = event.currentTarget;

                stickRef.current =
                    scroller.scrollHeight -
                        scroller.scrollTop -
                        scroller.clientHeight <=
                    80;
            }}
        >
            <div
                ref={contentRef}
                className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6"
            >
                {items.map((item, index) => (
                    <div key={item.id} className="flex flex-col gap-3">
                        <div
                            className={cn(
                                'flex items-start gap-2',
                                item.role === 'user' && 'justify-end',
                            )}
                        >
                            {item.role === 'assistant' && (
                                <AssistantAvatar
                                    {...assistant}
                                    className="hidden sm:flex"
                                />
                            )}
                            <div
                                role={
                                    item.role === 'error' ? 'alert' : undefined
                                }
                                className={cn(
                                    'min-w-0 text-sm leading-relaxed break-words',
                                    item.role !== 'assistant' &&
                                        'whitespace-pre-wrap',
                                    item.role === 'user' &&
                                        'max-w-[80%] self-end rounded-2xl bg-muted px-4 py-2.5',
                                    item.role === 'assistant' && 'self-start',
                                    item.role === 'error' &&
                                        'self-start rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2',
                                )}
                            >
                                {item.role === 'assistant' &&
                                    assistant?.name && (
                                        <span
                                            aria-hidden="true"
                                            className="mb-1 block text-xs font-medium text-muted-foreground"
                                        >
                                            {assistant.name}
                                        </span>
                                    )}
                                {item.role !== 'error' && (
                                    <span className="sr-only">
                                        {item.role === 'user'
                                            ? 'Bạn: '
                                            : `${assistant?.name || 'Trợ lý AI'}: `}
                                    </span>
                                )}
                                {item.role === 'assistant' ? (
                                    <ProposalText
                                        content={item.content}
                                        hasCard={
                                            (item.proposals?.length ?? 0) > 0
                                        }
                                        choices={
                                            onChoose
                                                ? {
                                                      // * Only the newest answer, while nothing is sending, can still be answered.
                                                      interactive:
                                                          !pending &&
                                                          index ===
                                                              items.length - 1,
                                                      answer:
                                                          items[index + 1]
                                                              ?.role === 'user'
                                                              ? items[
                                                                    index + 1
                                                                ].content.trim()
                                                              : null,
                                                      onChoose,
                                                  }
                                                : undefined
                                        }
                                    />
                                ) : (
                                    item.content
                                )}
                            </div>
                            {item.role === 'user' && (
                                <UserAvatar
                                    name={userName}
                                    avatar={userAvatar}
                                />
                            )}
                        </div>
                        {item.role === 'assistant' &&
                            typeof item.id === 'number' &&
                            item.proposals &&
                            item.proposals.length > 0 && (
                                // * Same left edge as the answer text: the avatar (size-7) plus its gap (gap-2).
                                <div className="min-w-0 sm:pl-9">
                                    <ProposalCard
                                        messageId={item.id}
                                        proposals={item.proposals}
                                        onChange={(next) =>
                                            onProposalsChange(item.id, next)
                                        }
                                        onOpenFile={onOpenFile}
                                    />
                                </div>
                            )}
                    </div>
                ))}
                {pending && (
                    <PendingStatus
                        assistant={assistant}
                        imageRequest={
                            lastUser ? asksForImage(lastUser.content) : false
                        }
                    />
                )}
            </div>
        </div>
    );
}
