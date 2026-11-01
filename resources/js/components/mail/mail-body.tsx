import { ImageOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

type MailBodyProps = {
    html: string | null;
    text: string | null;
    snippet: string;
    truncated: boolean;
    // * Initial state only (deep link `?show_images=1`); the choice is per message and never remembered.
    initialShowImages?: boolean;
};

// * Remote images load only after the user presses "Hiện ảnh": the CSP below blocks `https:` images (also in CSS `url()`) until then.
const BASE_STYLE =
    'body{margin:0;padding:8px;font:14px/1.5 system-ui,sans-serif;color:#18181b;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}';

function contentSecurityPolicy(showImages: boolean): string {
    return [
        "default-src 'none'",
        "style-src 'unsafe-inline'",
        `img-src data:${showImages ? ' https:' : ''}`,
        'font-src data:',
    ].join('; ');
}

/** * Whether the (already sanitised) HTML points at remote images, to decide if the "Hiện ảnh" bar is useful. */
function hasRemoteImages(html: string): boolean {
    return (
        /<img[^>]+src\s*=\s*["']?https:/i.test(html) ||
        /url\(\s*["']?https:/i.test(html)
    );
}

/**
 * Mail HTML is sanitised on the server and shown here in a sandboxed iframe: no scripts, no same-origin access, links open
 * in a new tab. Plain text is rendered as text, never as HTML.
 */
export function MailBody({
    html,
    text,
    snippet,
    truncated,
    initialShowImages = false,
}: MailBodyProps) {
    const [showImages, setShowImages] = useState(initialShowImages);

    const srcDoc = useMemo(
        () =>
            html === null
                ? null
                : `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(showImages)}"><base target="_blank"><style>${BASE_STYLE}</style></head><body>${html}</body></html>`,
        [html, showImages],
    );

    if (srcDoc !== null && html !== null) {
        return (
            <div className="flex flex-col gap-2">
                {!showImages && hasRemoteImages(html) && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
                        <ImageOff
                            aria-hidden="true"
                            className="size-4 text-muted-foreground"
                        />
                        <span>Ảnh từ xa đã bị chặn.</span>
                        <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0"
                            onClick={() => setShowImages(true)}
                        >
                            Hiện ảnh
                        </Button>
                    </div>
                )}
                <iframe
                    title="Nội dung thư"
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    referrerPolicy="no-referrer"
                    srcDoc={srcDoc}
                    className="h-[28rem] w-full rounded-md border bg-white"
                />
                {truncated && <TruncatedNote />}
            </div>
        );
    }

    if (text !== null && text !== '') {
        return (
            <div className="flex flex-col gap-2">
                <div className="text-sm break-words whitespace-pre-wrap">
                    {text}
                </div>
                {truncated && <TruncatedNote />}
            </div>
        );
    }

    return (
        <p className="text-sm text-muted-foreground">
            {snippet !== '' ? snippet : '(Thư không có nội dung)'}
        </p>
    );
}

function TruncatedNote() {
    return (
        <p className="text-xs text-muted-foreground">
            Thư quá dài nên chỉ hiện phần đầu.
        </p>
    );
}
