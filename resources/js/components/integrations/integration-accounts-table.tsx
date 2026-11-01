import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { DataTable } from '@/components/tables/data-table';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { RowActionsMenu } from '@/components/tables/row-actions-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';
import type { IntegrationAccountSummary } from '@/types';

const STATUS_LABEL: Record<IntegrationAccountSummary['status'], string> = {
    connected: 'Đã kết nối',
    error: 'Lỗi kết nối',
    disconnected: 'Đã ngắt kết nối',
};

const STATUS_STYLE: Record<IntegrationAccountSummary['status'], string> = {
    connected: 'bg-secondary text-foreground',
    error: 'bg-destructive text-white',
    disconnected: 'bg-muted text-muted-foreground',
};

function initialsOf(name: string | null, fallback: string): string {
    const letters = (name ?? '').trim().split(/\s+/).filter(Boolean);

    return (
        (letters.length > 1
            ? letters[0][0] + letters[letters.length - 1][0]
            : (letters[0]?.slice(0, 2) ?? '')
        ).toUpperCase() || fallback
    );
}

function dateOrDash(value: string | null): string {
    return value ? formatDateTime(value) : '—';
}

/** * Accounts a chat channel is signed in with, one row each, on the shared DataTable; scopes and disconnect are per account. */
export function IntegrationAccountsTable({
    accounts,
    disabled,
    fallbackName,
    fallbackInitials,
    emptyMessage,
    onAdd,
    onSettings,
    onDisconnect,
    onReconnect,
    onDelete,
    renderExtraActions,
}: {
    accounts: IntegrationAccountSummary[];
    disabled: boolean;
    /** * Shown when an account has no name yet. */
    fallbackName: string;
    fallbackInitials: string;
    emptyMessage: string;
    onAdd: () => void;
    onSettings: (account: IntegrationAccountSummary) => void;
    onDisconnect: (account: IntegrationAccountSummary) => void;
    /** * Channel-specific row buttons placed between "Cài đặt" and "Ngắt kết nối". */
    /** * With both set, disconnected rows get "Chỉnh sửa" and "Xóa"; otherwise they show no actions. */
    onReconnect?: () => void;
    onDelete?: (account: IntegrationAccountSummary) => void;
    renderExtraActions?: (account: IntegrationAccountSummary) => ReactNode;
}) {
    const columns: ColumnDef<IntegrationAccountSummary>[] = [
        {
            id: 'name',
            accessorKey: 'name',
            meta: { label: 'Tài khoản' },
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Tài khoản" />
            ),
            cell: ({ row }) => (
                <div className="flex items-center gap-3">
                    <Avatar>
                        <AvatarImage
                            src={row.original.avatar_url ?? undefined}
                            alt=""
                        />
                        <AvatarFallback aria-hidden="true">
                            {initialsOf(row.original.name, fallbackInitials)}
                        </AvatarFallback>
                    </Avatar>
                    <span className="font-medium">
                        {row.original.name ?? fallbackName}
                    </span>
                </div>
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
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[row.original.status]}`}
                    >
                        {STATUS_LABEL[row.original.status]}
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
            id: 'last_checked_at',
            accessorKey: 'last_checked_at',
            meta: { label: 'Kiểm tra lần cuối' },
            header: ({ column }) => (
                <DataTableColumnHeader
                    column={column}
                    title="Kiểm tra lần cuối"
                />
            ),
            cell: ({ row }) => dateOrDash(row.original.last_checked_at),
        },
        {
            id: 'connected_at',
            accessorKey: 'connected_at',
            meta: { label: 'Kết nối lúc' },
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Kết nối lúc" />
            ),
            cell: ({ row }) => dateOrDash(row.original.connected_at),
        },
        {
            id: 'actions',
            meta: { label: 'Hành động' },
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }) =>
                row.original.status === 'disconnected' ? (
                    onReconnect &&
                    onDelete && (
                        <div className="flex justify-end">
                            <RowActionsMenu
                                items={[
                                    {
                                        label: 'Chỉnh sửa',
                                        onSelect: onReconnect,
                                        disabled,
                                    },
                                    {
                                        label: 'Xóa',
                                        onSelect: () => onDelete(row.original),
                                        destructive: true,
                                        disabled,
                                    },
                                ]}
                            />
                        </div>
                    )
                ) : (
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            onClick={() => onSettings(row.original)}
                        >
                            Cài đặt
                        </Button>
                        {renderExtraActions?.(row.original)}
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            onClick={() => onDisconnect(row.original)}
                        >
                            Ngắt kết nối
                        </Button>
                    </div>
                ),
        },
    ];

    return (
        <DataTable
            columns={columns}
            data={accounts}
            hideCreate
            searchPlaceholder="Tìm tài khoản..."
            emptyMessage={emptyMessage}
            toolbarActions={
                <Button type="button" disabled={disabled} onClick={onAdd}>
                    <Plus aria-hidden="true" />
                    Thêm tài khoản
                </Button>
            }
        />
    );
}
