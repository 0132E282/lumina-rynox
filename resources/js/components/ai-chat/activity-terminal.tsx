import { Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ActivityEntry = {
    id: number;
    time: string;
    level: 'info' | 'ok' | 'error';
    text: string;
};

const PREFIX = { info: '›', ok: '✓', error: '✗' } as const;

/** * Read-only terminal-style log of what this chat page did (sends, repo reads, pull requests). It runs nothing and takes no input. */
export function ActivityTerminal({
    entries,
    onClear,
    onClose,
}: {
    entries: ActivityEntry[];
    onClear: () => void;
    onClose: () => void;
}) {
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end' });
    }, [entries.length]);

    return (
        <section
            aria-label="Nhật ký hoạt động"
            className="flex h-56 shrink-0 flex-col border-t bg-zinc-950 text-zinc-200"
        >
            <header className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 px-3 text-xs text-zinc-400">
                <span>Terminal · chỉ đọc</span>
                <span className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Xoá nhật ký"
                        onClick={onClear}
                        className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                        <Trash2 aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Đóng terminal"
                        onClick={onClose}
                        className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
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
                                    entry.level === 'ok' && 'text-green-400',
                                    entry.level === 'error' && 'text-red-400',
                                    entry.level === 'info' && 'text-sky-400',
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
        </section>
    );
}
