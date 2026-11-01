import { Link, router } from '@inertiajs/react';
import { Paperclip } from 'lucide-react';
import { show } from '@/actions/App/Http/Controllers/MailController';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    formatDate,
    formatDateTimePersonal,
    todayIso,
} from '@/lib/personal-date';
import { cn } from '@/lib/utils';
import type { MailMessageRow, MailTab } from '@/types';

function previousDay(iso: string): string {
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);

    return date.toISOString().slice(0, 10);
}

/** * Today → `HH:mm`, yesterday → "Hôm qua", otherwise `dd/mm/yyyy`; all in the personal time zone. */
function formatMailTime(iso: string): string {
    const full = formatDateTimePersonal(iso);
    const day = full.slice(0, 10);

    if (day === formatDate(todayIso())) {
        return full.slice(11);
    }

    return day === formatDate(previousDay(todayIso())) ? 'Hôm qua' : day;
}

export function MailListTable({
    messages,
    tab,
    emptyText,
}: {
    messages: MailMessageRow[];
    tab: MailTab;
    emptyText: string;
}) {
    return (
        <div className="rounded-lg border bg-card">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-6" />
                        <TableHead>
                            {tab === 'sent' ? 'Người nhận' : 'Người gửi'}
                        </TableHead>
                        <TableHead>Tiêu đề</TableHead>
                        <TableHead className="w-8" />
                        <TableHead>Thời gian</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {messages.length === 0 && (
                        <TableRow>
                            <TableCell
                                colSpan={5}
                                className="h-24 text-center text-muted-foreground"
                            >
                                {emptyText}
                            </TableCell>
                        </TableRow>
                    )}
                    {messages.map((message) => (
                        <TableRow
                            key={message.id}
                            className="cursor-pointer align-top"
                            onClick={() =>
                                router.visit(show.url({ message: message.id }))
                            }
                        >
                            <TableCell>
                                {!message.seen && (
                                    <span
                                        role="img"
                                        aria-label="Chưa đọc"
                                        className="mt-1.5 block size-2 rounded-full bg-primary"
                                    />
                                )}
                            </TableCell>
                            <TableCell className="max-w-56">
                                <div
                                    className={cn(
                                        'truncate',
                                        !message.seen && 'font-semibold',
                                    )}
                                >
                                    {message.party_name ?? message.party_email}
                                </div>
                                {message.party_name && (
                                    <div className="truncate text-xs text-muted-foreground">
                                        {message.party_email}
                                    </div>
                                )}
                            </TableCell>
                            <TableCell className="max-w-xl whitespace-normal">
                                <Link
                                    href={show.url({ message: message.id })}
                                    onClick={(event) => event.stopPropagation()}
                                    className={cn(
                                        'block truncate',
                                        !message.seen && 'font-semibold',
                                    )}
                                >
                                    {message.subject || '(Không có tiêu đề)'}
                                </Link>
                                <p className="truncate text-xs text-muted-foreground">
                                    {message.snippet}
                                </p>
                            </TableCell>
                            <TableCell>
                                {message.has_attachments && (
                                    <Paperclip
                                        role="img"
                                        aria-label="Có đính kèm"
                                        className="size-4 text-muted-foreground"
                                    />
                                )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                                {message.received_at
                                    ? formatMailTime(message.received_at)
                                    : ''}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
