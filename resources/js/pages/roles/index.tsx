import { useConfirm } from '@/components/confirm-dialog';
import { PermissionsDialog } from '@/components/file-manager/permissions-dialog';
import { FolderPermissionTree } from '@/components/permissions/folder-permission-tree';
import { RoleDialog } from '@/components/permissions/role-dialog';
import { createColumn, createSelectColumn } from '@/components/tables/columns';
import { DataTable } from '@/components/tables/data-table';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Role } from '@/types';
import '@/types';
import { Head, router } from '@inertiajs/react';
import type { ColumnDef } from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

type TreeFile = { id: number; parent_id: number | null; name: string };

export default function RolesIndex({
    roles,
    fileTree,
}: {
    roles: Role[];
    search: string;
    fileTree: TreeFile[];
}) {
    const [roleDialog, setRoleDialog] = useState<{
        open: boolean;
        roleId: number | null;
    }>({ open: false, roleId: null });
    const [folderPermissions, setFolderPermissions] = useState<{
        id: number;
        name: string;
    } | null>(null);
    const confirm = useConfirm();

    const reload = () => router.reload({ only: ['roles'] });

    const columns: ColumnDef<Role>[] = [
        createSelectColumn<Role>(),
        {
            accessorKey: 'name',
            meta: { label: 'Tên vai trò' },
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Tên vai trò" />
            ),
            cell: ({ row }) => (
                <button
                    type="button"
                    className="font-medium text-blue-600 dark:text-blue-400"
                    onClick={() =>
                        setRoleDialog({ open: true, roleId: row.original.id })
                    }
                >
                    {row.original.name}
                </button>
            ),
        },
        {
            accessorKey: 'permissions_count',
            meta: { label: 'Số quyền' },
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Số quyền" />
            ),
            cell: ({ row }) => (
                <Badge variant="outline">
                    {row.original.permissions_count ?? 0}
                </Badge>
            ),
        },
        createColumn<Role>({ accessorKey: 'created_at', label: 'Ngày tạo' }),
        {
            id: 'actions',
            meta: { label: 'Hành động' },
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }) => (
                <div className="flex justify-end gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={async () => {
                            const ok = await confirm({
                                title: `Xóa vai trò "${row.original.name}"?`,
                                description:
                                    'Hành động này không thể hoàn tác. Vai trò sẽ bị xóa vĩnh viễn.',
                                confirmLabel: 'Xóa',
                                destructive: true,
                            });

                            if (ok) {
                                router.delete(`/roles/${row.original.id}`, {
                                    preserveScroll: true,
                                });
                            }
                        }}
                    >
                        <Trash2 className="size-4" />
                    </Button>
                </div>
            ),
        },
    ];

    return (
        <div className="flex h-full flex-1 flex-col p-4">
            <Head title="Vai trò & Phân quyền" />

            <Tabs defaultValue="roles">
                <TabsList>
                    <TabsTrigger value="roles">Vai trò</TabsTrigger>
                    <TabsTrigger value="folders">
                        Phân quyền thư mục
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="roles">
                    <DataTable
                        columns={columns}
                        data={roles}
                        searchPlaceholder="Tìm kiếm vai trò..."
                        onCreate={() =>
                            setRoleDialog({ open: true, roleId: null })
                        }
                    />
                </TabsContent>

                <TabsContent value="folders">
                    <FolderPermissionTree
                        files={fileTree}
                        onManage={(id, name) =>
                            setFolderPermissions({ id, name })
                        }
                    />
                </TabsContent>
            </Tabs>

            <RoleDialog
                roleId={roleDialog.roleId}
                open={roleDialog.open}
                onOpenChange={(open) =>
                    setRoleDialog((prev) => ({ ...prev, open }))
                }
                onSaved={reload}
            />

            <PermissionsDialog
                fileId={folderPermissions?.id ?? null}
                fileName={folderPermissions?.name ?? ''}
                open={folderPermissions !== null}
                onOpenChange={(open) => !open && setFolderPermissions(null)}
            />
        </div>
    );
}
