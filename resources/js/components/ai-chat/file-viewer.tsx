import {
    Download,
    Maximize,
    Maximize2,
    Minimize2,
    X,
    ZoomIn,
    ZoomOut,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { CodeBlock } from '@/components/ai-chat/code-block';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { downloadViewerFile } from '@/lib/viewer-file';
import type { ViewerFile } from '@/lib/viewer-file';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

// * A page shown in the preview can load nothing and run nothing: no scripts, no network, no same-origin access.
const HTML_CSP =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">';

/**
 * Right-hand file viewer: header (name and type, download, expand, close) and tabs by type.
 * svg: Xem trước (an `<img>` of a sanitised Blob URL, revoked on cleanup) and Mã; html: Xem trước in an iframe with `sandbox=""` and a CSP, and Mã;
 * md: Xem trước with the markdown renderer and Mã; everything else: Mã only. Zoom applies to the svg/html preview. State lives in memory only.
 */
export function FileViewer({
    file,
    onClose,
    expanded,
    onToggleExpand,
}: {
    file: ViewerFile;
    onClose: () => void;
    expanded: boolean;
    onToggleExpand: () => void;
}) {
    const { kind } = file.type;
    const hasPreview = kind !== 'code';
    const [zoom, setZoom] = useState(1);
    const [tab, setTab] = useState(hasPreview ? 'preview' : 'code');
    const [url, setUrl] = useState<string | null>(null);

    // * A new file starts at "fit" on its first tab.
    useEffect(() => {
        setZoom(1);
        setTab(hasPreview ? 'preview' : 'code');
    }, [file, hasPreview]);

    useEffect(() => {
        if (kind !== 'svg') {
            setUrl(null);

            return;
        }

        const objectUrl = URL.createObjectURL(
            new Blob([file.safe ?? ''], { type: 'image/svg+xml' }),
        );

        setUrl(objectUrl);

        return () => URL.revokeObjectURL(objectUrl);
    }, [kind, file.safe]);

    const zoomable = kind === 'svg' || kind === 'html';
    const zoomBy = (factor: number) =>
        setZoom((current) =>
            Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor)),
        );
    const ExpandIcon = expanded ? Minimize2 : Maximize2;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <Tabs
                value={tab}
                onValueChange={setTab}
                className="min-h-0 flex-1 gap-0"
            >
                <div className="flex items-center gap-2 border-b px-3 py-2">
                    <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
                        {file.title} · {file.type.label}
                    </h2>
                    {hasPreview && (
                        <TabsList className="h-8">
                            <TabsTrigger
                                value="preview"
                                className="px-3 text-xs"
                            >
                                Xem trước
                            </TabsTrigger>
                            <TabsTrigger value="code" className="px-3 text-xs">
                                Mã
                            </TabsTrigger>
                        </TabsList>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Tải xuống ${file.fileName}`}
                        title="Tải xuống"
                        onClick={() => downloadViewerFile(file)}
                    >
                        <Download aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="hidden size-8 lg:inline-flex"
                        aria-label={expanded ? 'Thu gọn bảng' : 'Mở rộng bảng'}
                        aria-pressed={expanded}
                        title={expanded ? 'Thu gọn' : 'Mở rộng'}
                        onClick={onToggleExpand}
                    >
                        <ExpandIcon aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="Đóng bảng xem tệp"
                        title="Đóng"
                        onClick={onClose}
                    >
                        <X aria-hidden="true" />
                    </Button>
                </div>
                {hasPreview && (
                    <TabsContent value="preview" className="relative min-h-0">
                        <div
                            className={
                                kind === 'md'
                                    ? 'h-full overflow-auto p-4 text-sm leading-relaxed'
                                    : 'flex h-full min-h-0 items-center justify-center overflow-auto bg-muted/60 p-4'
                            }
                        >
                            {kind === 'svg' && url && (
                                <img
                                    src={url}
                                    alt={file.title}
                                    draggable={false}
                                    style={
                                        zoom === 1
                                            ? undefined
                                            : {
                                                  width: `${zoom * 100}%`,
                                                  maxWidth: 'none',
                                              }
                                    }
                                    className={
                                        zoom === 1
                                            ? 'max-h-full max-w-full rounded bg-background object-contain'
                                            : 'm-auto h-auto rounded bg-background'
                                    }
                                />
                            )}
                            {kind === 'html' && (
                                <div
                                    className="h-full w-full origin-top-left"
                                    style={
                                        zoom === 1
                                            ? undefined
                                            : {
                                                  transform: `scale(${zoom})`,
                                                  width: `${100 / zoom}%`,
                                                  height: `${100 / zoom}%`,
                                              }
                                    }
                                >
                                    <iframe
                                        title={file.title}
                                        sandbox=""
                                        referrerPolicy="no-referrer"
                                        srcDoc={`${HTML_CSP}${file.source}`}
                                        className="h-full w-full rounded border bg-white"
                                    />
                                </div>
                            )}
                            {kind === 'md' && (
                                <MarkdownContent content={file.source} />
                            )}
                        </div>
                        {zoomable && (
                            <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow-sm">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label="Thu nhỏ"
                                    disabled={zoom <= MIN_ZOOM}
                                    onClick={() => zoomBy(1 / ZOOM_STEP)}
                                >
                                    <ZoomOut aria-hidden="true" />
                                </Button>
                                <span
                                    aria-live="polite"
                                    className="w-10 text-center text-xs tabular-nums"
                                >
                                    {Math.round(zoom * 100)}%
                                </span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label="Phóng to"
                                    disabled={zoom >= MAX_ZOOM}
                                    onClick={() => zoomBy(ZOOM_STEP)}
                                >
                                    <ZoomIn aria-hidden="true" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label="Vừa khung"
                                    onClick={() => setZoom(1)}
                                >
                                    <Maximize aria-hidden="true" />
                                </Button>
                            </div>
                        )}
                    </TabsContent>
                )}
                <TabsContent
                    value="code"
                    className="min-h-0 overflow-y-auto px-3"
                >
                    <CodeBlock
                        title={file.fileName}
                        code={file.source}
                        diffRows={null}
                    >
                        {file.source}
                    </CodeBlock>
                </TabsContent>
            </Tabs>
        </div>
    );
}
