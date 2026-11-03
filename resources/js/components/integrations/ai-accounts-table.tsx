import type { ColumnDef } from '@tanstack/react-table';
import { CircleAlert, CircleCheck, CircleOff, Plus, Power } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { VendorBadge } from '@/components/ai-chat/vendor-badge';
import { RowActionsMenu } from '@/components/tables/row-actions-menu';
import { AccountLimit } from '@/components/integrations/account-limit';
import { DataTable } from '@/components/tables/data-table';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { Button } from '@/components/ui/button';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatDateTime } from '@/lib/utils';
import type { AiAccountSummary, AiOptions } from '@/types';

const STATUS_LABEL: Record<AiAccountSummary['status'], string> = {
    connected: 'Đã kết nối',
    error: 'Kết nối lỗi',
    disconnected: 'Chưa kết nối',
};

const STATUS_ICON: Record<AiAccountSummary['status'], LucideIcon> = {
    connected: CircleCheck,
    error: CircleAlert,
    disconnected: CircleOff,
};

const STATUS_STYLE: Record<AiAccountSummary['status'], string> = {
    connected: 'text-emerald-600',
    error: 'text-destructive',
    disconnected: 'text-muted-foreground',
};

const CLI_NAME: Record<string, string> = {
    anthropic: 'claude',
    openai: 'codex',
    google: 'gemini',
};

// * A generated name ends with the token type ("OpenAI / Codex · Session token 2"): a CLI account shows as "codex CLI" like "claude CLI", an API one drops the suffix.
const shortName = (account: AiAccountSummary) => {
    const generated = / (?: · API token| · Session token| CLI)(?= \d+$|$)/;

    if (!generated.test(account.name)) {
        return account.name;
    }

    return account.auth_type === 'session_token' && CLI_NAME[account.vendor]
        ? `${CLI_NAME[account.vendor]} CLI`
        : account.name.replace(generated, '');
};

/** * Status as text; only a failed connection shows a tooltip, with the provider's error. */
function StatusText({ account }: { account: AiAccountSummary }) {
    const label = account.enabled
        ? STATUS_LABEL[account.status]
        : 'Không hoạt động';
    const Icon = account.enabled ? STATUS_ICON[account.status] : Power;
    const error =
        account.enabled && account.status === 'error'
            ? account.last_error
            : null;

    const color = account.enabled
        ? STATUS_STYLE[account.status]
        : 'text-muted-foreground';
    const content = (
        <>
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {label}
        </>
    );

    // * Only a failed connection has something more to say, so only it gets a tooltip.
    if (!error) {
        return (
            <span
                className={`inline-flex items-center gap-1.5 text-sm font-medium ${color}`}
            >
                {content}
            </span>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    className={`inline-flex items-center gap-1.5 rounded-sm text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${color}`}
                >
                    {content}
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
                <p>{error}</p>
            </TooltipContent>
        </Tooltip>
    );
}

/** * AI accounts, one row each, on the shared DataTable; the token column only ever shows the stored mask. */
export function AiAccountsTable({
    accounts,
    options,
    disabled,
    onAdd,
    onEdit,
    onToggle,
    onTest,
    onDelete,
}: {
    accounts: AiAccountSummary[];
    options: AiOptions;
    disabled: boolean;
    onAdd: () => void;
    onEdit: (account: AiAccountSummary) => void;
    onToggle: (account: AiAccountSummary) => void;
    onTest: (account: AiAccountSummary) => void;
    onDelete: (account: AiAccountSummary) => void;
}) {
    const labelOf = (list: { value: string; label: string }[], value: string) =>
        list.find((item) => item.value === value)?.label ?? value;

    const columns: ColumnDef<AiAccountSummary>[] = [
        {
            id: 'name',
            accessorKey: 'name',
            meta: { label: 'Tài khoản' },
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Tài khoản" />
            ),
            cell: ({ row }) => (
                <div className="flex min-w-64 items-center gap-3 whitespace-normal">
                    <VendorBadge
                        vendorKey={row.original.vendor}
                        fallback={labelOf(options.vendors, row.original.vendor)}
                    />
                    <div>
                        <p className="font-medium">{shortName(row.original)}</p>
                        <p className="text-xs text-muted-foreground">
                            {labelOf(options.vendors, row.original.vendor)}
                            {row.original.model
                                ? ` · ${row.original.model}`
                                : ''}
                        </p>
                    </div>
                </div>
            ),
        },
        {
            id: 'auth_type',
            accessorKey: 'auth_type',
            meta: { label: 'Token' },
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Token" />
            ),
            cell: ({ row }) => (
                <div className="min-w-56 whitespace-normal">
                    <p>{labelOf(options.auth_types, row.original.auth_type)}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                        {row.original.token_mask ?? '—'}
                    </p>
                </div>
            ),
        },
        {
            id: 'priority',
            accessorKey: 'priority',
            meta: { label: 'Ưu tiên' },
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Ưu tiên" />
            ),
        },
        {
            id: 'status',
            accessorKey: 'status',
            meta: { label: 'Trạng thái' },
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Trạng thái" />
            ),
            cell: ({ row }) => <StatusText account={row.original} />,
        },
        {
            id: 'limit',
            meta: { label: 'Giới hạn' },
            enableSorting: false,
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Giới hạn" />
            ),
            cell: ({ row }) => (
                <div
                    className="min-w-64 whitespace-normal"
                    title="Lấy từ lỗi thật của nhà cung cấp, không có số hạn mức còn lại."
                >
                    <AccountLimit limit={row.original.limit} />
                </div>
            ),
        },
        {
            id: 'last_checked_at',
            accessorKey: 'last_checked_at',
            meta: { label: 'Dùng lần cuối' },
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Dùng lần cuối" />
            ),
            cell: ({ row }) =>
                row.original.last_checked_at
                    ? formatDateTime(row.original.last_checked_at)
                    : '—',
        },
        {
            id: 'actions',
            meta: { label: 'Hành động' },
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }) => (
                <div className="flex justify-end">
                    <RowActionsMenu
                        triggerLabel={`Mở menu hành động của ${row.original.name}`}
                        items={[
                            {
                                label: 'Kiểm tra',
                                disabled,
                                onSelect: () => onTest(row.original),
                            },
                            {
                                label: row.original.enabled ? 'Tắt' : 'Bật',
                                disabled,
                                onSelect: () => onToggle(row.original),
                            },
                            {
                                label: 'Sửa',
                                disabled,
                                onSelect: () => onEdit(row.original),
                            },
                            {
                                label: 'Xoá',
                                destructive: true,
                                disabled,
                                onSelect: () => onDelete(row.original),
                            },
                        ]}
                    />
                </div>
            ),
        },
    ];

    return (
        <>
            <DataTable
                columns={columns}
                data={accounts}
                hideCreate
                hideSearch
                emptyMessage='Chưa có tài khoản AI nào. Bấm "Thêm tài khoản" để bắt đầu.'
                toolbarActions={
                    <Button type="button" disabled={disabled} onClick={onAdd}>
                        <Plus aria-hidden="true" />
                        Thêm tài khoản
                    </Button>
                }
            />
            <p className="text-xs text-muted-foreground">
                Cột Giới hạn chỉ lấy từ lỗi thật của nhà cung cấp (loại limit và
                giờ reset nếu lỗi nêu rõ), không có số hạn mức còn lại.
            </p>
        </>
    );
}
