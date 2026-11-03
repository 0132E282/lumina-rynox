import { FileCode, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { doneTyping, isTyping } from '@/lib/typing';
import { ProposalText } from '@/components/ai-chat/proposal-text';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import { VoiceAnswer } from '@/components/ai-chat/voice-answer';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import { splitFileTags } from '@/lib/code-reference';
import { asksForImage } from '@/lib/image-request';
import { ProposalCard } from '@/components/ai-chat/proposal-card';
import type {
    AiChatActivityStep,
    AiChatMessage,
    AiChatProposal,
} from '@/types';
import { WorkSteps } from '@/components/ai-chat/work-steps';
import { cn } from '@/lib/utils';

/** * Persisted messages plus local ones (not yet saved user bubble, error line), which have string ids. */
export type ThreadItem = {
    id: number | string;
    role: AiChatMessage['role'] | 'error';
    content: string;
    proposals?: AiChatProposal[];
    /** * What the app did for this answer (this visit only; it is not stored). */
    steps?: AiChatActivityStep[];
};

const THINKING_AFTER_SECONDS = 2;

/** * Shows `content` as if typed: a few characters per tick, the whole answer in about 3 seconds at most. Nothing is animated for reduced motion or an answer already shown. */
function useTyped(id: number | string, content: string): string {
    const [typed, setTyped] = useState(() =>
        isTyping(id) &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 0
            : content.length,
    );

    useEffect(() => {
        if (typed >= content.length) {
            doneTyping(id);

            return;
        }

        const step = Math.max(2, Math.ceil(content.length / 120));
        const timer = window.setTimeout(
            () => setTyped((current) => current + step),
            25,
        );

        return () => window.clearTimeout(timer);
    }, [typed, content.length, id]);

    return typed >= content.length ? content : content.slice(0, typed);
}

/** * One answer of the assistant; types itself in when it has just arrived. */
function TypedProposalText({
    id,
    content,
    ...rest
}: { id: number | string; content: string } & Omit<
    ComponentProps<typeof ProposalText>,
    'content'
>) {
    return <ProposalText content={useTyped(id, content)} {...rest} />;
}

/** * Real request state only (the backend is synchronous, no streaming): "sending" at first, then "thinking" with elapsed seconds. Mounted only while pending, so the timer restarts for each send. */
function PendingStatus({
    assistant,
    imageRequest,
    steps,
}: {
    assistant?: AssistantIdentity;
    /** What the app has done so far for this message (streamed while it works). */
    steps: AiChatActivityStep[];
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
                    <span>
                        {imageRequest
                            ? 'Đang tạo ảnh…'
                            : thinking
                              ? 'Trợ lý đang suy nghĩ…'
                              : 'Đang gửi…'}
                    </span>
                    {(thinking || imageRequest) && (
                        <span className="tabular-nums">
                            {seconds >= 60
                                ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
                                : `${seconds}s`}
                        </span>
                    )}
                </span>
                <WorkSteps steps={steps} live className="mt-2" />
                {imageRequest && (
                    // * Placeholder frame for the picture: a dot grid with drifting bright patches and a progress estimate (the real time is unknown, so it eases toward 95%).
                    <span
                        aria-hidden="true"
                        className="pm-dots relative mt-2 block aspect-square w-[min(32rem,calc(100vw-8rem))] overflow-hidden rounded-xl"
                    >
                        <span className="absolute right-3 bottom-3 rounded-full border bg-background px-3 py-1 text-sm font-medium text-blue-700 tabular-nums shadow-sm dark:text-blue-300">
                            {Math.round(95 * (1 - Math.exp(-seconds / 25)))}%
                        </span>
                    </span>
                )}
            </div>
        </div>
    );
}

/** * Message thread: user bubble on the right, assistant text on the left. User/error content is plain text (line breaks kept); assistant content is markdown. Never raw HTML. */
/** * A sent message: the files it was sent with show as tags (like in the box it was typed in) before the text. */
function UserContent({ content }: { content: string }) {
    const { files, text } = splitFileTags(content);

    if (files.length === 0) {
        return <>{content}</>;
    }

    return (
        <>
            <span className="flex flex-wrap gap-1.5">
                {files.map((path, index) => (
                    <span
                        key={`${path}-${index}`}
                        title={path}
                        className="flex max-w-60 items-center gap-1 rounded-md border bg-background/60 px-1.5 py-0.5 text-xs"
                    >
                        <FileCode
                            aria-hidden="true"
                            className="size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span className="truncate font-medium">
                            {path.split('/').pop() ?? path}
                        </span>
                    </span>
                ))}
            </span>
            {text !== '' && <span className="mt-2 block">{text}</span>}
        </>
    );
}

export function ChatThread({
    items,
    pending,
    onProposalsChange,
    onOpenFile,
    onChoose,
    liveSteps = [],
    assistant,
    onRetry,
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
    /** * Steps of the answer being waited for. */
    liveSteps?: AiChatActivityStep[];
    /** * Asks again the last question that got an error; without it the error line has no button. */
    onRetry?: () => void;
    /** Decorative avatars: the signed-in person's name/photo and the AI account's vendor. */
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
            // * relative: the screen-reader-only spans inside are absolutely positioned; without a positioned scroller they would stretch the page behind it.
            className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
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
                                {item.role === 'assistant' && item.steps && (
                                    <WorkSteps
                                        steps={item.steps}
                                        className="mb-2"
                                    />
                                )}
                                {item.role === 'assistant' ? (
                                    <VoiceAnswer
                                        id={item.id}
                                        text={item.content}
                                    >
                                        <TypedProposalText
                                            id={item.id}
                                            content={item.content}
                                            hasCard={
                                                (item.proposals?.length ?? 0) >
                                                0
                                            }
                                            choices={
                                                onChoose
                                                    ? {
                                                          // * Only the newest answer, while nothing is sending, can still be answered.
                                                          interactive:
                                                              !pending &&
                                                              index ===
                                                                  items.length -
                                                                      1,
                                                          answer:
                                                              items[index + 1]
                                                                  ?.role ===
                                                              'user'
                                                                  ? items[
                                                                        index +
                                                                            1
                                                                    ].content.trim()
                                                                  : null,
                                                          onChoose,
                                                      }
                                                    : undefined
                                            }
                                        />
                                    </VoiceAnswer>
                                ) : item.role === 'user' ? (
                                    <UserContent content={item.content} />
                                ) : (
                                    item.content
                                )}
                                {item.role === 'error' &&
                                    onRetry &&
                                    !pending &&
                                    index === items.length - 1 && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={onRetry}
                                            className="mt-2 flex h-7 gap-1.5 text-xs"
                                        >
                                            <RotateCcw aria-hidden="true" />
                                            Gửi lại
                                        </Button>
                                    )}
                            </div>
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
                                        onExecutePlan={onChoose}
                                    />
                                </div>
                            )}
                    </div>
                ))}
                {pending && (
                    <PendingStatus
                        assistant={assistant}
                        steps={liveSteps}
                        imageRequest={
                            lastUser ? asksForImage(lastUser.content) : false
                        }
                    />
                )}
            </div>
        </div>
    );
}
