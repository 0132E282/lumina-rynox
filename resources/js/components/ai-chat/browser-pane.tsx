import { ArrowLeft, ArrowRight, ExternalLink, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const STORAGE_KEY = 'ai-chat.browser.url';

/** * "localhost:3000" or "3000" becomes a full address; only http(s) is ever loaded. Null when the text is not a usable address. */
export function toUrl(text: string): string | null {
    const value = text.trim();

    if (value === '') {
        return null;
    }

    const full = /^\d{2,5}$/.test(value)
        ? `http://localhost:${value}`
        : /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
          ? value
          : `http://${value}`;

    try {
        const url = new URL(full);

        return url.protocol === 'http:' || url.protocol === 'https:'
            ? url.href
            : null;
    } catch {
        return null;
    }
}

const savedUrl = (): string | null => {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
};

/** * Browser column beside the chat: an address bar and the page in a frame, to try a project running on this machine (the person starts its dev server). */
export function BrowserPane({ onClose }: { onClose: () => void }) {
    const first = savedUrl();
    const [history, setHistory] = useState<string[]>(first ? [first] : []);
    const [index, setIndex] = useState(first ? 0 : -1);
    const [text, setText] = useState(first ?? '');
    const [error, setError] = useState<string | null>(null);
    // * Bumped to load the same address again (the frame's own reload is blocked across origins).
    const [reload, setReload] = useState(0);
    const current = index >= 0 ? history[index] : null;

    const go = (event: FormEvent) => {
        event.preventDefault();

        const url = toUrl(text);

        if (url === null) {
            setError(
                'Địa chỉ không hợp lệ (chỉ http/https, ví dụ localhost:3000).',
            );

            return;
        }

        setError(null);
        setText(url);

        try {
            localStorage.setItem(STORAGE_KEY, url);
        } catch {
            // * The address is only a convenience; the page works without storing it.
        }

        if (url === current) {
            setReload((value) => value + 1);

            return;
        }

        setHistory((rows) => [...rows.slice(0, index + 1), url]);
        setIndex((value) => value + 1);
    };

    const move = (step: -1 | 1) => {
        const next = index + step;

        setIndex(next);
        setText(history[next]);
    };

    return (
        <section
            aria-label="Trình duyệt"
            className="flex h-full min-h-0 flex-col bg-background"
        >
            <header className="flex h-10 shrink-0 items-center justify-between border-b px-3 text-xs text-muted-foreground">
                <span>Trình duyệt</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Đóng trình duyệt"
                    onClick={onClose}
                    className="size-7"
                >
                    <X aria-hidden="true" />
                </Button>
            </header>
            <form
                onSubmit={go}
                className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Lùi"
                    disabled={index <= 0}
                    onClick={() => move(-1)}
                    className="size-7 shrink-0"
                >
                    <ArrowLeft aria-hidden="true" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Tiến"
                    disabled={index >= history.length - 1}
                    onClick={() => move(1)}
                    className="size-7 shrink-0"
                >
                    <ArrowRight aria-hidden="true" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Tải lại"
                    disabled={current === null}
                    onClick={() => setReload((value) => value + 1)}
                    className="size-7 shrink-0"
                >
                    <RotateCw aria-hidden="true" />
                </Button>
                <Input
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="Nhập URL, ví dụ localhost:3000"
                    aria-label="Địa chỉ"
                    aria-invalid={error !== null}
                    className="h-8 min-w-0 flex-1"
                />
                {current !== null && (
                    <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                    >
                        <a
                            href={current}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label="Mở trong tab mới"
                            title="Mở trong tab mới"
                        >
                            <ExternalLink aria-hidden="true" />
                        </a>
                    </Button>
                )}
            </form>
            {error && (
                <p
                    role="alert"
                    className="px-3 py-1.5 text-xs text-destructive"
                >
                    {error}
                </p>
            )}
            {current === null ? (
                <p className="m-auto max-w-64 px-4 text-center text-sm text-muted-foreground">
                    Chạy dev server của dự án trên máy rồi nhập địa chỉ (ví dụ
                    localhost:3000) để xem và thử ngay tại đây.
                </p>
            ) : (
                <iframe
                    key={`${current}#${reload}`}
                    src={current}
                    title="Trang đang thử"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                    className="min-h-0 flex-1 border-0 bg-white"
                />
            )}
        </section>
    );
}
