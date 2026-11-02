import { Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ActivityEntry = {
    id: number;
    time: string;
    level: 'info' | 'ok' | 'error';
    text: string;
};

const PREFIX = { info: '›', ok: '✓', error: '✗' } as const;

/** * Read-only terminal-style log (a side-panel column) of what this chat page did (sends, repo reads, pull requests). It runs nothing and takes no input. */
export function ActivityTerminal({
    entries,
    onClear,
    onClose,
    onRun,
}: {
    entries: ActivityEntry[];
    onClear: () => void;
    onClose: () => void;
    /** Runs a typed command in the open local project; null when there is none (the terminal then only shows the log). */
    onRun: ((command: string) => Promise<void>) | null;
}) {
    const [command, setCommand] = useState('');
    const [running, setRunning] = useState(false);
    const [history, setHistory] = useState<string[]>([]);
    const [recall, setRecall] = useState<number | null>(null);

    const submit = async () => {
        const value = command.trim();

        if (onRun === null || value === '' || running) {
            return;
        }

        setHistory((current) => [...current, value]);
        setRecall(null);
        setCommand('');
        setRunning(true);

        try {
            await onRun(value);
        } finally {
            setRunning(false);
        }
    };

    const browseHistory = (step: -1 | 1) => {
        const next =
            recall === null
                ? step === -1
                    ? history.length - 1
                    : null
                : recall + step;

        if (next === null || next < 0 || next >= history.length) {
            setRecall(null);
            setCommand('');

            return;
        }

        setRecall(next);
        setCommand(history[next]);
    };

    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end' });
    }, [entries.length]);

    return (
        // * Fills the side panel it sits in (a column beside the chat, like an editor's terminal dock).
        <section
            aria-label="Nhật ký hoạt động"
            className="flex h-full min-h-0 flex-col bg-zinc-50 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
        >
            <header className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-200 px-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <span>Terminal · chỉ đọc</span>
                <span className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Xoá nhật ký"
                        onClick={onClear}
                        className="size-7 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                        <Trash2 aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Đóng terminal"
                        onClick={onClose}
                        className="size-7 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                        <X aria-hidden="true" />
                    </Button>
                </span>
            </header>
            <div
                role="log"
                aria-live="polite"
                className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-5"
            >
                {entries.length === 0 ? (
                    <p className="text-zinc-500">Chưa có hoạt động nào.</p>
                ) : (
                    entries.map((entry) => (
                        <div key={entry.id} className="flex gap-2">
                            <span className="shrink-0 text-zinc-500">
                                {entry.time}
                            </span>
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'shrink-0',
                                    entry.level === 'ok' &&
                                        'text-green-600 dark:text-green-400',
                                    entry.level === 'error' &&
                                        'text-red-600 dark:text-red-400',
                                    entry.level === 'info' &&
                                        'text-sky-600 dark:text-sky-400',
                                )}
                            >
                                {PREFIX[entry.level]}
                            </span>
                            <span className="break-words whitespace-pre-wrap">
                                {entry.text}
                            </span>
                        </div>
                    ))
                )}
                <div ref={endRef} />
            </div>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                }}
                className="flex shrink-0 items-center gap-2 border-t border-zinc-200 px-3 py-2 font-mono text-xs dark:border-zinc-800"
            >
                <span
                    aria-hidden="true"
                    className="text-sky-600 dark:text-sky-400"
                >
                    ›
                </span>
                <input
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            browseHistory(-1);
                        } else if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            browseHistory(1);
                        }
                    }}
                    disabled={onRun === null || running}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Nhập lệnh"
                    placeholder={
                        onRun === null
                            ? 'Mở một dự án local để chạy lệnh'
                            : running
                              ? 'Đang chạy…'
                              : 'Nhập lệnh rồi Enter'
                    }
                    className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
                />
            </form>
        </section>
    );
}
