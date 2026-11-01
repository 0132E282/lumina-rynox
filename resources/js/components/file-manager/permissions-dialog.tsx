import { router } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

type PermissionRole = { id: number; name: string };
type RoleGrant = { read: boolean; write: boolean; delete: boolean };

const EMPTY_GRANT: RoleGrant = { read: false, write: false, delete: false };

export function PermissionsDialog({
    fileId,
    fileName,
    open,
    onOpenChange,
}: {
    fileId: number | null;
    fileName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [roles, setRoles] = useState<PermissionRole[]>([]);
    const [grants, setGrants] = useState<Record<number, RoleGrant>>({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open || fileId === null) {
            return;
        }

        setLoading(true);
        fetch(`/file-manager/${fileId}/permissions`, {
            headers: { Accept: 'application/json' },
        })
            .then((res) => res.json())
            .then(
                (data: {
                    roles: PermissionRole[];
                    permissions: Record<number, RoleGrant>;
                }) => {
                    setRoles(data.roles);
                    setGrants(data.permissions);
                },
            )
            .finally(() => setLoading(false));
    }, [open, fileId]);

    const toggle = (roleId: number, key: keyof RoleGrant) => {
        setGrants((prev) => ({
            ...prev,
            [roleId]: {
                ...(prev[roleId] ?? EMPTY_GRANT),
                [key]: !(prev[roleId]?.[key] ?? false),
            },
        }));
    };

    const handleSave = () => {
        if (fileId === null) {
            return;
        }

        setSaving(true);
        router.post(
            `/file-manager/${fileId}/permissions`,
            {
                grants: Object.entries(grants).map(([roleId, grant]) => ({
                    role_id: Number(roleId),
                    read: grant.read,
                    write: grant.write,
                    delete: grant.delete,
                })),
            },
            {
                preserveScroll: true,
                onFinish: () => setSaving(false),
                onSuccess: () => onOpenChange(false),
            },
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Phân quyền thư mục "{fileName}"</DialogTitle>
                </DialogHeader>

                {loading ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        Đang tải...
                    </p>
                ) : roles.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        Chưa có vai trò nào.
                    </p>
                ) : (
                    <div className="max-h-80 space-y-1 overflow-y-auto">
                        <div className="grid grid-cols-[1fr_repeat(3,3rem)] items-center gap-2 px-2 pb-1 text-xs font-medium text-muted-foreground">
                            <span>Vai trò</span>
                            <span className="text-center">Đọc</span>
                            <span className="text-center">Ghi</span>
                            <span className="text-center">Xóa</span>
                        </div>
                        {roles.map((role) => {
                            const grant = grants[role.id] ?? EMPTY_GRANT;

                            return (
                                <div
                                    key={role.id}
                                    className="grid grid-cols-[1fr_repeat(3,3rem)] items-center gap-2 rounded-md px-2 py-2 hover:bg-muted"
                                >
                                    <span className="truncate text-sm font-medium">
                                        {role.name}
                                    </span>
                                    <Checkbox
                                        className="mx-auto"
                                        checked={grant.read}
                                        onCheckedChange={() =>
                                            toggle(role.id, 'read')
                                        }
                                        aria-label={`Quyền đọc cho ${role.name}`}
                                    />
                                    <Checkbox
                                        className="mx-auto"
                                        checked={grant.write}
                                        onCheckedChange={() =>
                                            toggle(role.id, 'write')
                                        }
                                        aria-label={`Quyền ghi cho ${role.name}`}
                                    />
                                    <Checkbox
                                        className="mx-auto"
                                        checked={grant.delete}
                                        onCheckedChange={() =>
                                            toggle(role.id, 'delete')
                                        }
                                        aria-label={`Quyền xóa cho ${role.name}`}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Hủy
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSave}
                        disabled={saving || loading}
                    >
                        Lưu phân quyền
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function PermissionsLabel({
    shared,
}: {
    shared: boolean | null | undefined;
}) {
    if (shared === null || shared === undefined) {
        return null;
    }

    return (
        <Label className="pointer-events-none text-[0.65rem] font-normal text-muted-foreground">
            {shared ? 'Đã phân quyền' : 'Chưa phân quyền'}
        </Label>
    );
}
