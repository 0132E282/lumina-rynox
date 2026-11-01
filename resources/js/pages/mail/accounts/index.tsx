import { Head, Link, router } from '@inertiajs/react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
    create,
    destroy,
    edit,
    sync,
} from '@/actions/App/Http/Controllers/MailboxController';
import { destroy as destroyIntegration } from '@/actions/App/Http/Controllers/IntegrationController';
import { useConfirm } from '@/components/confirm-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useHeaderActions } from '@/contexts/header-actions';
import { formatDateTimePersonal } from '@/lib/personal-date';
import { cn } from '@/lib/utils';
import type { MailAccountsIndexProps, Mailbox } from '@/types';

// * After "Đồng bộ ngay" the page re-reads the mailboxes every few seconds until the result shows up (or this long passes).
const SYNC_POLL_MS = 3000;
const SYNC_POLL_LIMIT_MS = 30000;

function StatusBadge({ mailbox }: { mailbox: Mailbox }) {
    return (
        <Badge
            variant={mailbox.status === 'error' ? 'destructive' : 'secondary'}
            className={cn(
                mailbox.status === 'connected' &&
                    'bg-chart-2/15 text-foreground',
            )}
        >
            {mailbox.status_label}
        </Badge>
    );
}

export default function MailAccountsIndex({
    mailboxes,
    legacy_config,
}: MailAccountsIndexProps) {
    const confirm = useConfirm();
    const [busy, setBusy] = useState(false);
    // * Mailbox whose sync was just requested, with its state at that moment, so the poll knows when something changed.
    const [waiting, setWaiting] = useState<{
        id: number;
        marker: string;
        since: number;
    } | null>(null);

    const marker = (mailbox: Mailbox | undefined) =>
        `${mailbox?.last_synced_at ?? ''}|${mailbox?.last_error ?? ''}`;

    useHeaderActions(
        <Link href={create.url()} className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" />
            Thêm hộp thư
        </Link>,
        [],
    );

    useEffect(() => {
        if (waiting === null) {
            return;
        }

        const current = mailboxes.find((mailbox) => mailbox.id === waiting.id);

        if (
            marker(current) !== waiting.marker ||
            Date.now() - waiting.since > SYNC_POLL_LIMIT_MS
        ) {
            setWaiting(null);

            return;
        }

        const timer = window.setTimeout(
            () => router.reload({ only: ['mailboxes'] }),
            SYNC_POLL_MS,
        );

        return () => window.clearTimeout(timer);
    }, [waiting, mailboxes]);

    const syncNow = (mailbox: Mailbox) => {
        setBusy(true);
        router.post(
            sync.url({ mailbox: mailbox.id }),
            {},
            {
                preserveScroll: true,
                onSuccess: () =>
                    setWaiting({
                        id: mailbox.id,
                        marker: marker(mailbox),
                        since: Date.now(),
                    }),
                onFinish: () => setBusy(false),
            },
        );
    };

    const removeMailbox = async (mailbox: Mailbox) => {
        if (
            await confirm({
                title: 'Xoá hộp thư?',
                description: `Hộp thư ${mailbox.email} và thư đã đồng bộ về app sẽ bị xoá khỏi app. Thư trên máy chủ không bị xoá.`,
                confirmLabel: 'Xoá hộp thư',
                destructive: true,
            })
        ) {
            router.delete(destroy.url({ mailbox: mailbox.id }), {
                preserveScroll: true,
            });
        }
    };

    const removeLegacy = async () => {
        if (
            await confirm({
                title: 'Xoá cấu hình Email cũ?',
                description:
                    'Mật khẩu và địa chỉ đã lưu ở form cũ sẽ bị xoá. Hộp thư bạn thêm ở trang này không bị ảnh hưởng.',
                confirmLabel: 'Xoá cấu hình cũ',
                destructive: true,
            })
        ) {
            router.delete(destroyIntegration.url({ provider: 'email' }), {
                preserveScroll: true,
            });
        }
    };

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
            <Head title="Hộp thư" />

            {legacy_config && (
                <Alert>
                    <AlertTitle>Có cấu hình Email cũ</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center gap-2">
                        <span>
                            Form Email trước đây chỉ lưu thông tin, không đọc
                            hay gửi thư và không được chuyển sang hộp thư mới.
                            Hãy thêm lại hộp thư ở đây rồi xoá cấu hình cũ.
                        </span>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={removeLegacy}
                        >
                            <Trash2 className="size-4" />
                            Xoá cấu hình cũ
                        </Button>
                    </AlertDescription>
                </Alert>
            )}

            <Card className="py-0">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Hộp thư</TableHead>
                                <TableHead>Trạng thái</TableHead>
                                <TableHead>Đồng bộ gần nhất</TableHead>
                                <TableHead>Tần suất</TableHead>
                                <TableHead className="text-right">
                                    Thao tác
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {mailboxes.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={5}
                                        className="h-24 text-center text-muted-foreground"
                                    >
                                        Chưa có hộp thư nào. Bấm &quot;Thêm hộp
                                        thư&quot; để kết nối bằng mật khẩu ứng
                                        dụng.
                                    </TableCell>
                                </TableRow>
                            )}
                            {mailboxes.map((mailbox) => {
                                const syncing = waiting?.id === mailbox.id;

                                return (
                                    <TableRow
                                        key={mailbox.id}
                                        className="align-top"
                                    >
                                        <TableCell className="whitespace-normal">
                                            <div className="font-medium">
                                                {mailbox.email}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                IMAP {mailbox.imap} · SMTP{' '}
                                                {mailbox.smtp}
                                            </div>
                                        </TableCell>
                                        <TableCell className="whitespace-normal">
                                            <StatusBadge mailbox={mailbox} />
                                            {syncing && (
                                                <div className="mt-1 text-xs text-muted-foreground">
                                                    Đang đồng bộ…
                                                </div>
                                            )}
                                            {mailbox.last_error && (
                                                <div className="mt-1 max-w-xs text-xs text-destructive">
                                                    {mailbox.last_error}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            {mailbox.last_synced_at
                                                ? formatDateTimePersonal(
                                                      mailbox.last_synced_at,
                                                  )
                                                : 'Chưa đồng bộ'}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            Mỗi {mailbox.sync_interval_minutes}{' '}
                                            phút
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap justify-end gap-2">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant={
                                                        mailbox.status ===
                                                        'error'
                                                            ? 'default'
                                                            : 'outline'
                                                    }
                                                    disabled={busy || syncing}
                                                    onClick={() =>
                                                        syncNow(mailbox)
                                                    }
                                                >
                                                    <RefreshCw className="size-4" />
                                                    {mailbox.status === 'error'
                                                        ? 'Thử lại'
                                                        : 'Đồng bộ ngay'}
                                                </Button>
                                                <Link
                                                    href={edit.url({
                                                        mailbox: mailbox.id,
                                                    })}
                                                    className={buttonVariants({
                                                        size: 'sm',
                                                        variant: 'outline',
                                                    })}
                                                >
                                                    Sửa
                                                </Link>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    aria-label={`Xoá hộp thư ${mailbox.email}`}
                                                    onClick={() =>
                                                        removeMailbox(mailbox)
                                                    }
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
