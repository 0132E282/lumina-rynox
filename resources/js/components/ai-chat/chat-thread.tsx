import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
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
function PendingStatus() {
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            setSeconds(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);

        return () => window.clearInterval(timer);
    }, []);

    const thinking = seconds >= THINKING_AFTER_SECONDS;

    return (
        <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 self-start text-sm text-muted-foreground"
        >
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
            <span>{thinking ? 'Trợ lý đang suy nghĩ…' : 'Đang gửi…'}</span>
            {thinking && <span className="tabular-nums">{seconds}s</span>}
        </div>
    );
}

/** * Message thread: user bubble on the right, assistant text on the left. User/error content is plain text (line breaks kept); assistant content is markdown. Never raw HTML. */
export function ChatThread({
    items,
    pending,
    onProposalsChange,
    onChoose,
}: {
    items: ThreadItem[];
    pending: boolean;
    onProposalsChange: (
        id: number | string,
        proposals: AiChatProposal[],
    ) => void;
    /** Sends a picked ```choices option as the next user message; without it the cards stay read-only. */
    onChoose?: (text: string) => void;
}) {
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end' });
    }, [items.length, pending]);

    return (
        <div
            // * pt-12: the floating toolbar (terminal, GitHub, code) sits in the top corners; the thread scrolls below it, not under it.
            className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-12"
            aria-live="polite"
        >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
                {items.map((item, index) => (
                    <div key={item.id} className="flex flex-col gap-3">
                        <div
                            role={item.role === 'error' ? 'alert' : undefined}
                            className={cn(
                                'text-sm leading-relaxed break-words',
                                item.role !== 'assistant' &&
                                    'whitespace-pre-wrap',
                                item.role === 'user' &&
                                    'max-w-[80%] self-end rounded-2xl bg-muted px-4 py-2.5',
                                item.role === 'assistant' && 'self-start',
                                item.role === 'error' &&
                                    'self-start rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2',
                            )}
                        >
                            {item.role === 'assistant' ? (
                                <MarkdownContent
                                    content={item.content}
                                    choices={
                                        onChoose
                                            ? {
                                                  // * Only the newest answer, while nothing is sending, can still be answered.
                                                  interactive:
                                                      !pending &&
                                                      index ===
                                                          items.length - 1,
                                                  answer:
                                                      items[index + 1]?.role ===
                                                      'user'
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
                        {item.role === 'assistant' &&
                            typeof item.id === 'number' &&
                            item.proposals &&
                            item.proposals.length > 0 && (
                                <ProposalCard
                                    messageId={item.id}
                                    proposals={item.proposals}
                                    onChange={(next) =>
                                        onProposalsChange(item.id, next)
                                    }
                                />
                            )}
                    </div>
                ))}
                {pending && <PendingStatus />}
                <div ref={endRef} />
            </div>
        </div>
    );
}
