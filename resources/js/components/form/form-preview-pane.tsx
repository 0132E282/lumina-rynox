import { RotateCw, Search, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import { useSidebarFullyHidden } from '@/contexts/sidebar-collapse-context';
import { useQuery } from '@/hooks/use-query';
import { cn } from '@/lib/utils';

/** * Split-view preview state: open URL, per-page resize ratio, hidden sidebar. */
export function useFormPreview(pageUrl: string) {
    const storageKey = `form-layout:split-view:${pageUrl}`;
    const [splitUrl, setSplitUrl] = useState<string | null>(() =>
        sessionStorage.getItem(`${storageKey}:url`),
    );
    const [splitRatio, setSplitRatio] = useState(
        () => Number(sessionStorage.getItem(`${storageKey}:ratio`)) || 0.5,
    );
    const [reloadKey, setReloadKey] = useState(0);
    const [isResizing, setIsResizing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { setOpen: setSidebarOpen } = useSidebar();
    const [, setSidebarFullyHidden] = useSidebarFullyHidden();

    useEffect(() => {
        if (splitUrl) {
            setSidebarOpen(false);
            setSidebarFullyHidden(true);
        }
        // * Restore the sidebar-hiding effect only on mount; open()/close() handle user actions.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (splitUrl) {
            sessionStorage.setItem(`${storageKey}:url`, splitUrl);
        } else {
            sessionStorage.removeItem(`${storageKey}:url`);
        }
    }, [splitUrl, storageKey]);

    useEffect(() => {
        sessionStorage.setItem(`${storageKey}:ratio`, String(splitRatio));
    }, [splitRatio, storageKey]);

    const open = (nextUrl: string) => {
        setSidebarOpen(false);
        setSidebarFullyHidden(true);
        setSplitUrl(nextUrl);
    };

    const close = () => {
        setSplitUrl(null);
        setSidebarOpen(true);
        setSidebarFullyHidden(false);
    };

    const startResize = (event: React.PointerEvent) => {
        event.preventDefault();
        const container = containerRef.current;

        if (!container) {
            return;
        }

        // ! The iframe swallows pointermove mid-drag; disable its pointer-events so `window` keeps receiving moves.
        setIsResizing(true);

        const onMove = (moveEvent: PointerEvent) => {
            const { left, width } = container.getBoundingClientRect();
            const ratio = (moveEvent.clientX - left) / width;

            setSplitRatio(Math.min(0.8, Math.max(0.2, ratio)));
        };

        const onUp = () => {
            setIsResizing(false);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    return {
        containerRef,
        splitUrl,
        splitRatio,
        isResizing,
        reloadKey,
        open,
        close,
        startResize,
        reload: () => setReloadKey((key) => key + 1),
    };
}

type IndexStatus = {
    indexed: boolean;
    verdict: string;
    coverageState: string | null;
    lastCrawlTime: string | null;
};

const PREVIEW_WIDTH_OPTIONS = [
    { value: 375, label: 'Điện thoại — 375px' },
    { value: 768, label: 'Máy tính bảng — 768px' },
    { value: 1200, label: 'Desktop — 1200px' },
    { value: 1440, label: 'Desktop lớn — 1440px' },
];

export function FormPreviewPane({
    url,
    reloadKey,
    onReload,
    onClose,
    onResizeStart,
    isResizing,
    resource,
    recordId,
}: {
    url: string;
    reloadKey: number;
    onReload: () => void;
    onClose: () => void;
    onResizeStart: (event: React.PointerEvent) => void;
    isResizing: boolean;
    resource: string;
    recordId?: string | number;
}) {
    const [urlExpanded, setUrlExpanded] = useState(false);
    // * `onLoad` fires even when framing is blocked (undetectable cross-origin), so nudge to "open in new tab" after a delay.
    const [previewSlow, setPreviewSlow] = useState(false);
    // * Device width is a global preference (localStorage), unlike the per-page split state.
    const [previewWidth, setPreviewWidth] = useState(
        () => Number(localStorage.getItem('form-layout:preview-width')) || 1200,
    );
    const [indexStatusChecked, setIndexStatusChecked] = useState(false);

    useEffect(() => {
        localStorage.setItem('form-layout:preview-width', String(previewWidth));
    }, [previewWidth]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the "still loading?" flag each time the preview (re)loads
        setPreviewSlow(false);
        const timer = window.setTimeout(() => setPreviewSlow(true), 5000);

        return () => window.clearTimeout(timer);
    }, [url, reloadKey]);

    const {
        data: indexStatusResponse,
        loading: indexStatusLoading,
        error: indexStatusFetchError,
    } = useQuery<{ data: IndexStatus }>(
        indexStatusChecked && recordId ? 'items.index-status' : null,
        { resource, id: recordId },
    );

    const indexStatus: IndexStatus | 'loading' | 'unavailable' | null =
        !indexStatusChecked
            ? null
            : indexStatusLoading
              ? 'loading'
              : indexStatusFetchError
                ? 'unavailable'
                : (indexStatusResponse?.data ?? null);

    return (
        <>
            <div
                role="separator"
                aria-orientation="vertical"
                onPointerDown={onResizeStart}
                className="sticky top-(--header-height) h-[calc(100dvh-var(--header-height))] w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary active:bg-primary"
            />
            {/* * `sticky` keeps the pane on screen while the form scrolls the page normally. */}
            <div className="sticky top-(--header-height) flex h-[calc(100dvh-var(--header-height))] flex-1 flex-col overflow-hidden border-l">
                <div className="flex shrink-0 items-center justify-between border-b p-2">
                    <button
                        type="button"
                        onClick={() => setUrlExpanded((expanded) => !expanded)}
                        title="Bấm để xem đầy đủ URL"
                        className={cn(
                            'min-w-0 text-left text-xs text-muted-foreground hover:text-foreground',
                            !urlExpanded && 'truncate',
                        )}
                    >
                        {url}
                    </button>
                    <div className="flex items-center gap-1">
                        <select
                            value={previewWidth}
                            onChange={(event) =>
                                setPreviewWidth(Number(event.target.value))
                            }
                            className="h-7 rounded-md border bg-background px-1.5 text-xs"
                            title="Chiều rộng xem trước"
                        >
                            {PREVIEW_WIDTH_OPTIONS.map(({ value, label }) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </select>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Kiểm tra Google đã index chưa"
                            onClick={() => setIndexStatusChecked(true)}
                        >
                            <Search className="size-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Tải lại xem trước"
                            onClick={onReload}
                        >
                            <RotateCw className="size-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={onClose}
                        >
                            <X className="size-4" />
                        </Button>
                    </div>
                </div>
                {indexStatus && (
                    <div
                        className={cn(
                            'flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 text-xs',
                            indexStatus === 'loading' &&
                                'bg-muted text-muted-foreground',
                            indexStatus === 'unavailable' &&
                                'bg-amber-50 text-amber-900',
                            typeof indexStatus === 'object' &&
                                indexStatus.indexed &&
                                'bg-emerald-50 text-emerald-900',
                            typeof indexStatus === 'object' &&
                                !indexStatus.indexed &&
                                'bg-red-50 text-red-900',
                        )}
                    >
                        {indexStatus === 'loading' && (
                            <span>Đang kiểm tra Google Search Console…</span>
                        )}
                        {indexStatus === 'unavailable' && (
                            <span>
                                Chưa cấu hình Google Search Console (cần
                                GOOGLE_SEARCH_CONSOLE_CREDENTIALS_PATH /
                                GOOGLE_SEARCH_CONSOLE_SITE_URL) hoặc kiểm tra
                                thất bại.
                            </span>
                        )}
                        {typeof indexStatus === 'object' && (
                            <span>
                                {indexStatus.indexed
                                    ? 'Đã được Google index.'
                                    : `Chưa được index (${indexStatus.verdict}).`}
                                {indexStatus.lastCrawlTime &&
                                    ` Lần crawl gần nhất: ${indexStatus.lastCrawlTime}.`}
                            </span>
                        )}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6 shrink-0"
                            onClick={() => setIndexStatusChecked(false)}
                        >
                            <X className="size-3.5" />
                        </Button>
                    </div>
                )}
                {previewSlow && (
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <span>
                            Trang chưa hiển thị sau vài giây — có thể trang đích
                            không cho phép nhúng (X-Frame-Options/CSP). Hãy thử
                            mở trực tiếp.
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0"
                            asChild
                        >
                            <a href={url} target="_blank" rel="noreferrer">
                                Mở tab mới
                            </a>
                        </Button>
                    </div>
                )}
                {/* * Pinned to a desktop width (scrolls horizontally) so the site doesn't collapse to its mobile layout. */}
                <div className="flex-1 overflow-auto">
                    <iframe
                        key={reloadKey}
                        src={url}
                        title="Xem trước trang"
                        style={{ minWidth: previewWidth }}
                        className={cn(
                            'h-full w-full border-0',
                            isResizing && 'pointer-events-none',
                        )}
                    />
                </div>
            </div>
        </>
    );
}
