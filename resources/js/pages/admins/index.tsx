import { createLinkColumn } from '@/components/tables/columns';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { Badge } from '@/components/ui/badge';
import IndexLayout from '@/layouts/index-layout';
import { formatDateTime } from '@/lib/utils';
import type { Admin } from '@/types';
import '@/types';
import type { ColumnDef } from '@tanstack/react-table';

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

const STATUS_OPTIONS = [
    { label: 'Hoạt động', value: 'active' },
    { label: 'Bị khóa', value: 'locked' },
];

function isOnline(lastSeenAt: string | null): boolean {
    return (
        lastSeenAt !== null &&
        Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS
    );
}

const columns: ColumnDef<Admin>[] = [
    createLinkColumn<Admin>({
        accessorKey: 'name',
        label: 'Tên',
        href: (row) => `/admins/${row.id}`,
    }),
    {
        accessorKey: 'email',
        meta: { label: 'Email' },
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Email" />
        ),
    },
    {
        accessorKey: 'phone',
        meta: { label: 'Điện thoại' },
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Điện thoại" />
        ),
        cell: ({ row }) => row.original.phone ?? '—',
    },
    {
        accessorKey: 'system_admin',
        meta: {
            label: 'Phân quyền',
            filterRelation: { collection: 'roles', field: 'name' },
            filterMultiple: true,
        },
        header: 'Phân quyền',
        enableSorting: false,
        cell: ({ row }) => {
            if (row.original.system_admin) {
                return <Badge>Tất cả (Super Admin)</Badge>;
            }

            const roles = row.original.role_names ?? [];

            return roles.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                    {roles.map((role) => (
                        <Badge key={role} variant="outline">
                            {role}
                        </Badge>
                    ))}
                </div>
            ) : (
                <span className="text-sm text-muted-foreground">
                    Chưa có vai trò
                </span>
            );
        },
    },
    {
        accessorKey: 'status',
        meta: { label: 'Trạng thái', filterOptions: STATUS_OPTIONS },
        filterFn: 'arrIncludesSome',
        header: ({ column }) => (
            <DataTableColumnHeader
                column={column}
                title="Trạng thái"
                filterOptions={STATUS_OPTIONS}
            />
        ),
        cell: ({ row }) =>
            row.original.status === 'active' ? (
                <Badge>Hoạt động</Badge>
            ) : (
                <Badge variant="destructive">Bị khóa</Badge>
            ),
    },
    {
        accessorKey: 'last_seen_at',
        meta: { label: 'Online' },
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Online" />
        ),
        cell: ({ row }) => {
            const online = isOnline(row.original.last_seen_at);

            return (
                <div className="flex items-center gap-1.5">
                    <span
                        className={`size-2 rounded-full ${online ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
                    />
                    <span className="text-sm text-muted-foreground">
                        {online
                            ? 'Đang hoạt động'
                            : row.original.last_seen_at
                              ? formatDateTime(row.original.last_seen_at)
                              : 'Chưa từng'}
                    </span>
                </div>
            );
        },
    },
    {
        accessorKey: 'created_at',
        meta: { label: 'Ngày tạo', filterInputType: 'date' },
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Ngày tạo" />
        ),
        cell: ({ row }) => formatDateTime(row.original.created_at),
    },
];

export default function AdminsIndex() {
    return <IndexLayout<Admin> title="Quản trị viên" columns={columns} />;
}
