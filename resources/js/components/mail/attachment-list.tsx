import { Paperclip } from 'lucide-react';
import { formatSize } from '@/components/file-manager/format';
import type { MailAttachment } from '@/types';

/** * Lists attachments by name only: they are never downloaded or opened by this app (BR-003). */
export function AttachmentList({
    attachments,
}: {
    attachments: MailAttachment[];
}) {
    if (attachments.length === 0) {
        return null;
    }

    return (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Tệp đính kèm">
            {attachments.map((attachment, index) => (
                <li
                    key={`${attachment.name}-${index}`}
                    className="flex items-center gap-2 text-muted-foreground"
                >
                    <Paperclip aria-hidden="true" className="size-4 shrink-0" />
                    <span className="truncate text-foreground">
                        {attachment.name}
                    </span>
                    <span className="shrink-0 text-xs">
                        {formatSize(attachment.size)}
                    </span>
                </li>
            ))}
            <li className="text-xs text-muted-foreground">
                Tệp đính kèm chưa được tải về; xem trên webmail của hộp thư.
            </li>
        </ul>
    );
}
