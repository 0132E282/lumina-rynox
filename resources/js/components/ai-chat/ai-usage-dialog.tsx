import { AccountLimit } from '@/components/integrations/account-limit';
import { vendorShortName } from '@/lib/ai-account';
import { VendorBadge } from '@/components/ai-chat/vendor-badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useCachedRequest } from '@/hooks/use-cached-request';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import type { AiChatSelection, AiUsageAccount, AiUsageStats } from '@/types';

const STATUS: Record<string, { label: string; className: string }> = {
    active: {
        label: 'Hoạt động',
        className: 'text-green-600 dark:text-green-400',
    },
    error: { label: 'Lỗi', className: 'text-destructive' },
    quota: {
        label: 'Hết hạn mức (theo lỗi gần nhất)',
        className: 'text-amber-600 dark:text-amber-400',
    },
    unused: { label: 'Chưa có lượt gọi', className: 'text-muted-foreground' },
    disabled: { label: 'Đã tắt', className: 'text-muted-foreground' },
};

const formatTokens = (value: number): string =>
    new Intl.NumberFormat('vi').format(value);

/** * "Thống kê AI": which account is in use and which one stopped on its limit. Loaded when opened (one GET), so the chat page itself costs no extra query. */
export function AiUsageDialog({
    open,
    onOpenChange,
    selection,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The composer's current account: marked "Đang dùng". */
    selection: AiChatSelection;
}) {
    // * Shown from the cache at once and refreshed in the background after a minute (the server caches the same 60 s).
    const { data: stats, failed } = useCachedRequest(
        'usage',
        60_000,
        () => api.get<AiUsageStats>('/ai-chat/usage').then(({ data }) => data),
        open,
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[min(90vh,40rem)] flex-col sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Thống kê AI</DialogTitle>
                    <DialogDescription>
                        Tài khoản AI nào đang dùng và tài khoản nào đã dừng vì
                        hạn mức.
                    </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {failed ? (
                        <p role="alert" className="text-sm text-destructive">
                            Không tải được thống kê, hãy thử lại sau.
                        </p>
                    ) : stats === null ? (
                        <p className="text-sm text-muted-foreground">
                            Đang tải…
                        </p>
                    ) : !stats.available ? (
                        <p
                            role="alert"
                            className="text-sm text-amber-600 dark:text-amber-400"
                        >
                            Bảng thống kê chưa được tạo trong cơ sở dữ liệu
                            (chưa chạy migration). Hãy chạy{' '}
                            <code>php artisan migrate</code> rồi mở lại.
                        </p>
                    ) : stats.accounts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Chưa có dữ liệu.
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {stats.accounts.map((account) => (
                                <UsageRow
                                    key={account.id}
                                    account={account}
                                    inUse={account.id === selection.accountId}
                                />
                            ))}
                        </ul>
                    )}
                    {stats?.available &&
                        stats.history.replies_7d > 0 &&
                        stats.accounts.every(
                            (account) => account.calls_7d === 0,
                        ) && (
                            <p className="mt-3 text-sm text-muted-foreground">
                                Lịch sử chat của bạn có{' '}
                                {stats.history.replies_24h} câu trả lời trong 24
                                giờ và {stats.history.replies_7d} câu trong 7
                                ngày, nhưng lịch sử không lưu tài khoản nào đã
                                trả lời nên chưa chia theo tài khoản được. Số
                                liệu theo tài khoản bắt đầu từ lần gọi AI kế
                                tiếp.
                            </p>
                        )}
                </div>
                <p className="text-xs text-muted-foreground">
                    Số lượt gọi là của riêng bạn trong 24 giờ và 7 ngày qua,
                    tính từ các lần gọi AI thật (không lưu nội dung). Trạng thái
                    tính từ lượt gọi gần nhất của tài khoản: &quot;Hết hạn
                    mức&quot; chỉ hiện khi lỗi hạn mức gần nhất mới hơn lần gọi
                    thành công gần nhất. Không có số hạn mức còn lại vì nhà cung
                    cấp không cung cấp dữ liệu này. Số token là ước lượng
                    (khoảng 4 ký tự một token) từ độ dài văn bản, không phải số
                    liệu của nhà cung cấp; cửa sổ ngữ cảnh là giới hạn cho mỗi
                    yêu cầu, không phải hạn mức, và hạn mức còn lại không có
                    sẵn.
                </p>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Đóng
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function UsageRow({
    account,
    inUse,
}: {
    account: AiUsageAccount;
    inUse: boolean;
}) {
    const status = STATUS[account.status] ?? STATUS.unused;

    return (
        <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border p-3 text-sm">
            <VendorBadge
                vendorKey={account.vendor_key}
                fallback={account.vendor}
                className="size-8"
            />
            <span className="min-w-40 flex-1 leading-tight">
                <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{account.name}</span>
                    {inUse && (
                        <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                            Đang dùng
                        </span>
                    )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                    {[vendorShortName(account.vendor), account.model]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
            </span>
            <dl className="flex gap-4 text-xs">
                <div>
                    <dt className="text-muted-foreground">24 giờ</dt>
                    <dd className="tabular-nums">{account.calls_24h} lượt</dd>
                </div>
                <div>
                    <dt className="text-muted-foreground">7 ngày</dt>
                    <dd className="tabular-nums">{account.calls_7d} lượt</dd>
                </div>
                <div>
                    <dt className="text-muted-foreground">Lần dùng cuối</dt>
                    <dd>
                        {account.last_used_at
                            ? relativeTime(account.last_used_at)
                            : 'Chưa dùng'}
                    </dd>
                </div>
            </dl>
            <div className="w-full space-y-1 text-xs">
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                        <span className="text-muted-foreground">
                            Token ước lượng:{' '}
                        </span>
                        <span className="tabular-nums">
                            {formatTokens(account.tokens_24h)} / 24 giờ ·{' '}
                            {formatTokens(account.tokens_7d)} / 7 ngày
                        </span>
                    </span>
                    <span className="min-w-0 truncate">
                        <span className="text-muted-foreground">
                            Model đã dùng:{' '}
                        </span>
                        {account.models_used.length > 0
                            ? account.models_used.join(', ')
                            : 'Chưa có'}
                    </span>
                </p>
                <div className="flex items-center gap-2">
                    <span className="shrink-0 text-muted-foreground">
                        Cửa sổ ngữ cảnh mỗi yêu cầu:{' '}
                        {formatTokens(account.context_window)} token
                    </span>
                    {account.largest_request !== null && (
                        <>
                            <div
                                role="progressbar"
                                aria-label="Yêu cầu lớn nhất so với cửa sổ ngữ cảnh"
                                aria-valuemin={0}
                                aria-valuemax={account.context_window}
                                aria-valuenow={Math.min(
                                    account.largest_request,
                                    account.context_window,
                                )}
                                className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-muted"
                            >
                                <div
                                    className="h-full bg-primary"
                                    style={{
                                        width: `${Math.min(100, (account.largest_request / account.context_window) * 100)}%`,
                                    }}
                                />
                            </div>
                            <span className="shrink-0 text-muted-foreground">
                                Yêu cầu lớn nhất ~
                                {formatTokens(account.largest_request)}
                            </span>
                        </>
                    )}
                </div>
            </div>
            <span className={cn('w-full text-xs sm:w-44', status.className)}>
                {status.label}
                {account.limit.state === 'limited' && (
                    <>
                        {' · '}
                        <AccountLimit limit={account.limit} inline />
                    </>
                )}
                {account.status_at &&
                    account.status !== 'active' &&
                    ` · ${relativeTime(account.status_at)}`}
            </span>
        </li>
    );
}
