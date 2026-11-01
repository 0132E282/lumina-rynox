import { Check, Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { DiffView } from '@/components/ai-chat/diff-view';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { DiffRow } from '@/lib/diff-parser';

/** * Fenced block frame: title bar (file name, else language, else "code") with a copy button, then the diff view or the plain code. */
export function CodeBlock({
    title,
    code,
    diffRows,
    children,
}: {
    title: string;
    /** Raw source copied to the clipboard (the original diff for diff blocks). */
    code: string;
    diffRows: DiffRow[] | null;
    children: ReactNode;
}) {
    const { copied, copy } = useCopyToClipboard();

    return (
        <div className="my-3 overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
                {/* * Long paths keep their end visible: the start is cut (rtl + bdi, as in the file viewer bar). */}
                <span className="min-w-0 truncate" dir="rtl" title={title}>
                    <bdi>{title}</bdi>
                </span>
                <button
                    type="button"
                    onClick={() => copy(code)}
                    aria-label={copied ? 'Đã sao chép' : 'Sao chép đoạn mã'}
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                    {copied ? (
                        <Check className="size-3.5" aria-hidden />
                    ) : (
                        <Copy className="size-3.5" aria-hidden />
                    )}
                    <span>{copied ? 'Đã sao chép' : 'Sao chép'}</span>
                </button>
            </div>
            {diffRows ? (
                <DiffView rows={diffRows} />
            ) : (
                <pre className="overflow-x-auto bg-muted p-3 font-mono text-xs leading-relaxed">
                    {children}
                </pre>
            )}
        </div>
    );
}
