import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FileIcon } from '@/components/ai-chat/file-icon';

/** * One attached file in the composer, a square tile: a picture shows the picture only (no name), any other file shows its icon and its name on one line (cut with …). */
export function AttachmentTile({
    file,
    onRemove,
}: {
    file: File;
    onRemove: () => void;
}) {
    const isImage = file.type.startsWith('image/');
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!isImage) {
            return;
        }

        const objectUrl = URL.createObjectURL(file);

        setUrl(objectUrl);

        return () => URL.revokeObjectURL(objectUrl);
    }, [file, isImage]);

    return (
        <li
            title={file.name}
            className="group relative size-20 shrink-0 overflow-hidden rounded-xl border bg-muted"
        >
            {isImage ? (
                url !== null && (
                    <img
                        src={url}
                        alt={file.name}
                        draggable={false}
                        className="size-full object-cover"
                    />
                )
            ) : (
                <div className="flex size-full flex-col items-center justify-center gap-1 p-2">
                    <FileIcon name={file.name} className="size-7" />
                    <span className="w-full truncate text-center text-[11px] leading-tight">
                        {file.name}
                    </span>
                </div>
            )}
            <button
                type="button"
                aria-label={`Bỏ tệp ${file.name}`}
                onClick={onRemove}
                className="absolute top-1 right-1 rounded-full bg-background/90 p-0.5 text-muted-foreground shadow-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
                <X aria-hidden="true" className="size-3" />
            </button>
        </li>
    );
}
