import { Head, Link, router, usePoll } from '@inertiajs/react';
import {
    ChevronLeft,
    ChevronRight,
    CircleAlert,
    FileText,
    Mail,
    Plus,
    Search,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
    create,
    index as accountsIndex,
} from '@/actions/App/Http/Controllers/MailboxController';
import { index } from '@/actions/App/Http/Controllers/MailController';
import { MailListTable } from '@/components/mail/mail-list-table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHeaderActions } from '@/contexts/header-actions';
import { useDebounce } from '@/hooks/use-debounce';
import type { MailIndexProps, MailTab } from '@/types';

const ALL_MAILBOXES = 'all';
const POLL_MS = 60_000;

export default function MailIndex({
    messages,
    filters,
    stats,
    mailboxes,
    can,
}: MailIndexProps) {
    const [search, setSearch] = useState(filters.q);
    const debouncedSearch = useDebounce(search, 300);
    // * Latest filters for the debounced search effect, so it never navigates with a stale tab.
    const filtersRef = useRef(filters);
    filtersRef.current = filters;

    // * `mail:sync` runs on the server every minute; only the list-shaped props are re-read (the poll pauses while the tab is hidden).
    usePoll(POLL_MS, { only: ['messages', 'stats', 'mailboxes'] });

    useHeaderActions(
        can.manage_accounts ? (
            <Link
                href={create.url()}
                className={buttonVariants({ size: 'sm' })}
            >
                <Plus className="size-4" />
                Thêm hộp thư
            </Link>
        ) : null,
        [can.manage_accounts],
    );

    const navigate = (
        next: Partial<{
            tab: MailTab;
            mailbox: number | null;
            unread: boolean;
            q: string;
            page: number;
        }>,
    ) => {
        const merged = { ...filtersRef.current, ...next };

        router.get(
            index.url({
                query: {
                    ...(merged.tab !== 'inbox' ? { tab: merged.tab } : {}),
                    ...(merged.mailbox ? { mailbox: merged.mailbox } : {}),
                    ...(merged.unread ? { unread: 1 } : {}),
                    ...(merged.q !== '' ? { q: merged.q } : {}),
                    ...(next.page && next.page > 1 ? { page: next.page } : {}),
                },
            }),
            {},
            { preserveState: true, preserveScroll: true, replace: true },
        );
    };

    useEffect(() => {
        if (debouncedSearch !== filtersRef.current.q) {
            navigate({ q: debouncedSearch });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch]);

    const broken = mailboxes.filter((mailbox) => mailbox.status === 'error');
    const filtered =
        filters.q !== '' || filters.unread || filters.mailbox !== null;
    const emptyText =
        mailboxes.length === 0
            ? 'Chưa có hộp thư nào. Thêm hộp thư để đọc thư tại đây.'
            : filtered
              ? 'Không có thư phù hợp.'
              : 'Chưa có thư nào. Thư mới sẽ hiện sau lần đồng bộ kế tiếp.';

    const cards = [
        { label: 'Chưa đọc', value: stats.unread, icon: Mail },
        { label: 'Có đính kèm', value: stats.attachments, icon: FileText },
    ];

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
            <Head title="Email" />

            {broken.length > 0 && (
                <Alert variant="destructive">
                    <CircleAlert />
                    <AlertDescription className="flex flex-col gap-1">
                        {broken.map((mailbox) => (
                            <span key={mailbox.id}>
                                {mailbox.email}: {mailbox.status_label}
                                {mailbox.last_error
                                    ? `. ${mailbox.last_error}`
                                    : ''}
                            </span>
                        ))}
                        {can.manage_accounts && (
                            <Link
                                href={accountsIndex.url()}
                                className="underline"
                            >
                                Mở Hộp thư để thử lại hoặc sửa thông tin
                            </Link>
                        )}
                    </AlertDescription>
                </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                {cards.map(({ label, value, icon: Icon }) => (
                    <Card key={label} className="gap-2 py-4">
                        <CardContent className="flex flex-col gap-1">
                            <span className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Icon className="size-4" aria-hidden="true" />
                                {label}
                            </span>
                            <span className="text-2xl font-bold">{value}</span>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Tabs
                value={filters.tab}
                onValueChange={(value) =>
                    navigate({ tab: value as MailTab, page: 1 })
                }
            >
                <TabsList>
                    <TabsTrigger value="inbox">Hộp thư đến</TabsTrigger>
                    <TabsTrigger value="sent">Đã gửi</TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="flex flex-wrap items-center gap-2">
                <Select
                    value={
                        filters.mailbox === null
                            ? ALL_MAILBOXES
                            : String(filters.mailbox)
                    }
                    onValueChange={(value) =>
                        navigate({
                            mailbox:
                                value === ALL_MAILBOXES ? null : Number(value),
                        })
                    }
                >
                    <SelectTrigger className="w-56" aria-label="Chọn hộp thư">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL_MAILBOXES}>
                            Tất cả hộp thư ({mailboxes.length})
                        </SelectItem>
                        {mailboxes.map((mailbox) => (
                            <SelectItem
                                key={mailbox.id}
                                value={String(mailbox.id)}
                            >
                                {mailbox.email}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="relative min-w-60 flex-1">
                    <Search
                        aria-hidden="true"
                        className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Tìm theo người gửi, tiêu đề..."
                        aria-label="Tìm thư"
                        maxLength={100}
                        className="pl-9"
                    />
                </div>
                <Button
                    type="button"
                    variant={filters.unread ? 'default' : 'outline'}
                    aria-pressed={filters.unread}
                    onClick={() => navigate({ unread: !filters.unread })}
                >
                    Chưa đọc
                </Button>
                {can.manage_accounts && (
                    <Link
                        href={accountsIndex.url()}
                        className={buttonVariants({ variant: 'outline' })}
                    >
                        Quản lý hộp thư
                    </Link>
                )}
            </div>

            <MailListTable
                messages={messages.data}
                tab={filters.tab}
                emptyText={emptyText}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>
                    {messages.total === 0
                        ? 'Không có thư'
                        : `Hiển thị ${messages.from}-${messages.to} trên ${messages.total} thư`}
                </span>
                {messages.last_page > 1 && (
                    <div className="flex items-center gap-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Trang trước"
                            disabled={messages.current_page <= 1}
                            onClick={() =>
                                navigate({ page: messages.current_page - 1 })
                            }
                        >
                            <ChevronLeft className="size-4" />
                        </Button>
                        <span className="px-2">
                            {messages.current_page} / {messages.last_page}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Trang sau"
                            disabled={
                                messages.current_page >= messages.last_page
                            }
                            onClick={() =>
                                navigate({ page: messages.current_page + 1 })
                            }
                        >
                            <ChevronRight className="size-4" />
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
