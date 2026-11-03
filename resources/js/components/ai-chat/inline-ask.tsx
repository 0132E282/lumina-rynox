import { ArrowUp, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Field, Form } from '@/components/form';
import { Button } from '@/components/ui/button';
import { useAppForm } from '@/hooks/use-app-form';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import { aiErrorMessage } from '@/lib/ai-error';
import { WorkSteps } from '@/components/ai-chat/work-steps';
import type { AiChatActivityStep } from '@/types';
import { cn } from '@/lib/utils';

export type InlineAnswer = { answer: string; conversation: string };

type Turn = {
    question: string;
    answer: string | null;
    error?: boolean;
    /** * What the app did while this answer was coming (files read, the AI asked...). */
    steps: AiChatActivityStep[];
};

/** * One line saying what the assistant is doing right now. */
function doing(steps: AiChatActivityStep[]) {
    const last = steps.at(-1);

    if (last === undefined) {
        return 'Đang gửi…';
    }

    return last.kind === 'ask'
        ? 'Đang chờ AI trả lời…'
        : `Đang đọc ${last.detail || last.source}…`;
}

/**
 * The comment box under the lines picked in the code editor ("Chat với AI về đoạn này"): the question is typed and answered right there.
 * Later questions continue the same conversation, which the chat history keeps like any other.
 */
export function InlineAsk({
    label,
    assistant,
    ask,
    onClose,
    onHeight,
}: {
    label: string;
    /** * Name and avatar of the assistant, as in the chat thread. */
    assistant: AssistantIdentity;
    ask: (
        question: string,
        conversation: string | null,
        signal: AbortSignal,
        onStep: (step: AiChatActivityStep) => void,
    ) => Promise<InlineAnswer>;
    onClose: () => void;
    /** * Called when the box grows or shrinks, so it can be placed again. */
    onHeight: () => void;
}) {
    const box = useRef<HTMLDivElement>(null);
    const conversation = useRef<string | null>(null);
    const abort = useRef<AbortController | null>(null);
    // * The app's own form and field (react-hook-form) hold the question, like every other form.
    const form = useAppForm<{ question: string }>({
        defaultValues: { question: '' },
    });
    const [turns, setTurns] = useState<Turn[]>([]);
    const busy = turns.some((turn) => turn.answer === null);
    const [seconds, setSeconds] = useState(0);

    // * The seconds the current answer has taken.
    useEffect(() => {
        if (!busy) {
            return;
        }

        setSeconds(0);

        const timer = window.setInterval(
            () => setSeconds((value) => value + 1),
            1000,
        );

        return () => window.clearInterval(timer);
    }, [busy]);

    useEffect(() => {
        form.setFocus('question');

        const element = box.current;

        if (element === null) {
            return;
        }

        const observer = new ResizeObserver(() => onHeight());

        observer.observe(element);

        return () => {
            observer.disconnect();
            abort.current?.abort();
        };
    }, [onHeight, form]);

    const send = async (text: string) => {
        const question = text.trim();

        if (question === '' || busy) {
            return;
        }

        setTurns((current) => [
            ...current,
            { question, answer: null, steps: [] },
        ]);

        const controller = new AbortController();

        abort.current = controller;

        const finish = (answer: string, error = false) =>
            setTurns((current) =>
                current.map((turn, index) =>
                    index === current.length - 1
                        ? { ...turn, answer, error }
                        : turn,
                ),
            );

        try {
            const result = await ask(
                question,
                conversation.current,
                controller.signal,
                (step) =>
                    setTurns((current) =>
                        current.map((turn, index) =>
                            index === current.length - 1
                                ? { ...turn, steps: [...turn.steps, step] }
                                : turn,
                        ),
                    ),
            );

            conversation.current = result.conversation;
            finish(result.answer);
        } catch (caught) {
            if (!controller.signal.aborted) {
                // * The server's own reason (quota, login, timeout...), not a blind "try again".
                finish(aiErrorMessage(caught), true);
            }
        }
    };

    return (
        <div
            ref={box}
            className="pm-inline-ask mx-0 my-0.5 flex flex-col gap-2 rounded-lg border border-ring/60 bg-popover px-3 py-2 font-sans text-sm text-popover-foreground shadow-sm"
        >
            <div className="-mr-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono">
                    {label}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Đóng"
                    onClick={onClose}
                    className="size-6 shrink-0"
                >
                    <X aria-hidden="true" />
                </Button>
            </div>
            {turns.map((turn, index) => (
                <div key={index} className="flex flex-col gap-1">
                    <p className="font-medium whitespace-pre-wrap">
                        {turn.question}
                    </p>
                    <div className="flex items-start gap-2">
                        <AssistantAvatar {...assistant} />
                        <div className="min-w-0 flex-1">
                            <span className="mb-1 block text-xs font-medium text-muted-foreground">
                                {assistant.name ?? 'Trợ lý AI'}
                            </span>
                            {turn.answer === null ? (
                                <div className="text-muted-foreground">
                                    <p className="flex items-center gap-2">
                                        {/* * Typing dots, as in the chat thread: still when the person prefers reduced motion. */}
                                        <span
                                            aria-hidden="true"
                                            className="flex items-center gap-1"
                                        >
                                            {[0, 150, 300].map((delay) => (
                                                <span
                                                    key={delay}
                                                    style={{
                                                        animationDelay: `${delay}ms`,
                                                    }}
                                                    className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-bounce"
                                                />
                                            ))}
                                        </span>
                                        <span>{doing(turn.steps)}</span>
                                        <span className="tabular-nums">
                                            {seconds}s
                                        </span>
                                    </p>
                                    <WorkSteps
                                        steps={turn.steps}
                                        live
                                        className="mt-1"
                                    />
                                </div>
                            ) : turn.error ? (
                                <div className="flex flex-col items-start gap-1.5 select-text">
                                    <p className="text-sm text-destructive">
                                        {turn.answer}
                                    </p>
                                    {index === turns.length - 1 && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-7 gap-1.5 text-xs"
                                            onClick={() => {
                                                // * Drops the failed turn and asks the same question again.
                                                setTurns((current) =>
                                                    current.slice(0, -1),
                                                );
                                                void send(turn.question);
                                            }}
                                        >
                                            <RotateCcw
                                                aria-hidden="true"
                                                className="size-3"
                                            />
                                            Thử lại
                                        </Button>
                                    )}
                                </div>
                            ) : (
                                <div
                                    className={cn(
                                        'max-h-[min(32rem,60vh)] overflow-y-auto select-text',
                                        turn.error && 'text-destructive',
                                    )}
                                >
                                    <MarkdownContent
                                        content={turn.answer}
                                        // * A ```choices block becomes a card; picking an option asks it as the next question.
                                        choices={{
                                            interactive:
                                                !busy &&
                                                index === turns.length - 1,
                                            answer:
                                                turns[index + 1]?.question ??
                                                null,
                                            onChoose: (choice) =>
                                                void send(choice),
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}
            <Form
                form={form}
                withFieldGroup={false}
                className="flex items-end gap-2"
                onSubmit={form.handleSubmit(({ question }) => {
                    form.reset();
                    void send(question);
                })}
            >
                <div className="min-w-0 flex-1">
                    <Field
                        name="question"
                        ui="textarea"
                        autoComplete="off"
                        placeholder="Hỏi AI về đoạn này…"
                        onKeyDown={(
                            event: React.KeyboardEvent<
                                | HTMLInputElement
                                | HTMLTextAreaElement
                                | HTMLSelectElement
                            >,
                        ) => {
                            if (event.key === 'Escape') {
                                onClose();
                            } else if (
                                event.key === 'Enter' &&
                                !event.shiftKey &&
                                !event.nativeEvent.isComposing
                            ) {
                                event.preventDefault();
                                void form.handleSubmit(({ question }) => {
                                    form.reset();
                                    void send(question);
                                })();
                            }
                        }}
                    />
                </div>
                <Button
                    type="submit"
                    size="icon"
                    aria-label="Gửi"
                    disabled={busy}
                    className="size-9 shrink-0 rounded-full"
                >
                    <ArrowUp aria-hidden="true" />
                </Button>
            </Form>
        </div>
    );
}
