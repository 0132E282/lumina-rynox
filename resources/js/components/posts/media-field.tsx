import { Plus, Video, X } from 'lucide-react';
import { useState } from 'react';
import { FilePickerDialog } from '@/components/file-manager/file-picker-dialog';
import type { PostMedia, PostMediaType } from '@/types';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v'];

/** * Type is inferred from the file extension of the URL path; the server validates it again. */
export function mediaTypeOf(url: string): PostMediaType {
    const path = url.split(/[?#]/)[0] ?? '';
    const extension = path.split('.').pop()?.toLowerCase() ?? '';

    return VIDEO_EXTENSIONS.includes(extension) ? 'video' : 'image';
}

function absoluteUrl(value: string): string | null {
    try {
        const url = new URL(value, window.location.origin);

        return url.protocol === 'http:' || url.protocol === 'https:'
            ? url.toString()
            : null;
    } catch {
        return null;
    }
}

type MediaFieldProps = {
    value: PostMedia[];
    onChange: (value: PostMedia[]) => void;
    max: number;
    disabled?: boolean;
};

/** * Attachments as public URLs picked from the file manager (its dialog also takes a pasted link). Platforms download them by URL, so they must be reachable. */
export function MediaField({
    value,
    onChange,
    max,
    disabled,
}: MediaFieldProps) {
    const [pickerOpen, setPickerOpen] = useState(false);

    const add = (urls: string[]) => {
        // * The same file is never listed twice, whether it comes as a relative or an absolute link.
        const known = new Set(value.map((item) => item.url));
        const added = urls
            .map(absoluteUrl)
            .filter((url): url is string => url !== null)
            .filter((url) => {
                if (known.has(url)) {
                    return false;
                }

                known.add(url);

                return true;
            })
            .map((url): PostMedia => ({ url, type: mediaTypeOf(url) }));

        onChange([...value, ...added].slice(0, max));
    };

    return (
        <div className="flex flex-wrap gap-3">
            {value.map((item, index) => (
                <div
                    key={item.url}
                    className="relative size-24 shrink-0 overflow-hidden rounded-md border bg-muted"
                >
                    {item.type === 'image' ? (
                        <img
                            src={item.url}
                            alt=""
                            className="size-full object-cover"
                        />
                    ) : (
                        <span className="flex size-full items-center justify-center">
                            <Video className="size-6" aria-hidden="true" />
                        </span>
                    )}
                    <button
                        type="button"
                        disabled={disabled}
                        aria-label="Gỡ tệp đính kèm"
                        title="Xoá"
                        className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm hover:text-destructive disabled:opacity-50"
                        onClick={() =>
                            onChange(value.filter((_, i) => i !== index))
                        }
                    >
                        <X aria-hidden="true" className="size-3.5" />
                    </button>
                </div>
            ))}

            {value.length < max && (
                <button
                    type="button"
                    disabled={disabled}
                    aria-label="Thêm ảnh hoặc video"
                    className="flex size-24 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted/30 text-muted-foreground transition-colors hover:border-primary hover:bg-muted/50 disabled:opacity-50"
                    onClick={() => setPickerOpen(true)}
                >
                    <Plus aria-hidden="true" className="size-6" />
                </button>
            )}

            <FilePickerDialog
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onPick={add}
                multiple
            />
        </div>
    );
}
