import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { VendorBadge } from '@/components/ai-chat/vendor-badge';
import { RowActionsMenu } from '@/components/tables/row-actions-menu';
import { AccountLimit } from '@/components/integrations/account-limit';
import { DataTable } from '@/components/tables/data-table';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';
import type { AiAccountSummary, AiOptions } from '@/types';

const STATUS_LABEL: Record<AiAccountSummary['status'], string> = {
    connected: 'Hoạt động',
    error: 'Lỗi',
    disconnected: 'Chưa kết nối',
};

const STATUS_STYLE: Record<AiAccountSummary['status'], string> = {
    connected: 'bg-secondary text-foreground',
    error: 'bg-destructive text-white',
    disconnected: 'bg-muted text-muted-foreground',
};

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
                <div className="flex items-center gap-3 whitespace-normal">
                    <VendorBadge
                        vendorKey={row.original.vendor}
                        fallback={labelOf(options.vendors, row.original.vendor)}
                    />
                    <div>
                        <p className="font-medium">{row.original.name}</p>
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
                <div className="whitespace-normal">
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
            cell: ({ row }) => (
                <div className="whitespace-normal">
                    <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.original.enabled ? STATUS_STYLE[row.original.status] : 'bg-muted text-muted-foreground'}`}
                    >
                        {row.original.enabled
                            ? STATUS_LABEL[row.original.status]
                            : 'Đã tắt'}
                    </span>
                    {row.original.status === 'error' &&
                        row.original.last_error && (
                            <p
                                role="alert"
                                className="mt-1 text-xs text-destructive"
                            >
                                {row.original.last_error}
                            </p>
                        )}
                </div>
            ),
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
                    className="whitespace-normal"
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
