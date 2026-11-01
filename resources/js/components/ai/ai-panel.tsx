import { FileText, Loader2, Send, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { ask } from '@/actions/App/Http/Controllers/AiController';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { aiErrorMessage } from '@/lib/ai-error';
import { cn } from '@/lib/utils';

type PanelMessage = {
    id: number;
    role: 'user' | 'assistant' | 'error';
    text: string;
};

/** * Right-hand AI assistant: free questions and "Báo cáo hôm nay". Answers are text only; the assistant never sends or publishes anything. */
export function AiPanel({ onClose }: { onClose: () => void }) {
    const titleId = useId();
    const nextId = useRef(0);
    const [messages, setMessages] = useState<PanelMessage[]>([]);
    const [question, setQuestion] = useState('');
    const [busy, setBusy] = useState(false);

    const push = (role: PanelMessage['role'], text: string) =>
        setMessages((current) => [
            ...current,
            { id: nextId.current++, role, text },
        ]);

    const send = async (payload: { question?: string; report?: boolean }) => {
        if (busy) {
            return;
        }

        setBusy(true);
        push(
            'user',
            payload.report ? 'Báo cáo hôm nay' : (payload.question ?? ''),
        );

        try {
            const { data } = await api.post<{ answer: string }>(
                ask.url(),
                payload,
            );
            push('assistant', data.answer);
        } catch (caught) {
            push('error', aiErrorMessage(caught));
        } finally {
            setBusy(false);
        }
    };

    const submit = (event?: FormEvent) => {
        event?.preventDefault();
        const text = question.trim();

        if (text === '' || busy) {
            return;
        }

        setQuestion('');
        void send({ question: text });
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        // * `isComposing` keeps Enter from sending while an IME (Vietnamese Telex/VNI) is still composing.
        if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
        ) {
            event.preventDefault();
            submit();
        }
    };

    return (
        <aside
            aria-labelledby={titleId}
            className="flex h-full min-h-0 w-full flex-col bg-card"
        >
            <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <h2 id={titleId} className="text-sm font-semibold">
                    Trợ lý AI
                </h2>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    aria-label="Đóng trợ lý AI"
                >
                    <X aria-hidden="true" />
                </Button>
            </header>

            <div
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
                aria-live="polite"
            >
                {messages.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        Hỏi bất cứ điều gì hoặc bấm &quot;Báo cáo hôm nay&quot;.
                        Trợ lý chỉ soạn văn bản, không tự gửi tin hay đăng bài.
                    </p>
                )}
                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={cn(
                            'max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                            message.role === 'user' &&
                                'self-end bg-primary text-primary-foreground',
                            message.role === 'assistant' &&
                                'self-start bg-muted',
                            message.role === 'error' &&
                                'self-start border border-destructive/40 bg-destructive/10',
                        )}
                        role={message.role === 'error' ? 'alert' : undefined}
                    >
                        {message.text}
                    </div>
                ))}
                {busy && (
                    <Loader2
                        aria-label="Đang chờ trả lời"
                        className="size-4 text-muted-foreground motion-safe:animate-spin"
                    />
                )}
            </div>

            <form
                onSubmit={submit}
                className="flex flex-col gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            >
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={busy}
                    onClick={() => void send({ report: true })}
                >
                    <FileText aria-hidden="true" />
                    Báo cáo hôm nay
                </Button>
                <div className="flex items-end gap-2">
                    <textarea
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={1}
                        maxLength={2000}
                        aria-label="Nhập câu hỏi cho trợ lý AI"
                        placeholder="Nhập câu hỏi…"
                        className="[field-sizing:content] max-h-36 min-h-10 w-full resize-none rounded-sm border border-input bg-card px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                    />
                    <Button
                        type="submit"
                        size="icon"
                        disabled={busy || question.trim() === ''}
                        aria-label="Gửi câu hỏi"
                    >
                        <Send aria-hidden="true" />
                    </Button>
                </div>
            </form>
        </aside>
    );
}
