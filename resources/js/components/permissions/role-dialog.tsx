import { Link } from '@inertiajs/react';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { useWatch } from 'react-hook-form';
import { Field, Form } from '@/components/form';
import {
    PermissionMatrix,
    toPermissionGroups,
} from '@/components/permissions/permission-matrix';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useAppForm, z } from '@/hooks/use-app-form';
import {
    toggleGroupPermissions,
    togglePermission,
    usePermissionCatalog,
} from '@/hooks/use-permission-editor';

const roleSchema = z.object({
    name: z.string().min(1, 'Tên vai trò là bắt buộc'),
    permissions: z.array(z.string()),
});

type RoleValues = z.infer<typeof roleSchema>;

export function RoleDialog({
    roleId,
    open,
    onOpenChange,
    onSaved,
}: {
    /** * null = creating a new role. */
    roleId: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved?: () => void;
}) {
    const isEdit = roleId !== null;
    const url = isEdit
        ? `/roles/${roleId}/permissions-data`
        : '/roles/permissions-catalog';
    const { name, permissions, groups, loading } = usePermissionCatalog(
        url,
        open,
    );

    const form = useAppForm<RoleValues>({
        schema: roleSchema,
        defaultValues: { name: '', permissions: [] },
    });
    const {
        control,
        setValue,
        reset,
        formState: { isSubmitting },
    } = form;
    const selected = useWatch({ control, name: 'permissions' });

    useEffect(() => {
        if (!loading) {
            reset({ name, permissions });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, name, permissions]);

    const isAllSelected =
        Object.values(groups).flat().length > 0 &&
        selected.length === Object.values(groups).flat().length;

    const onSubmit = form.submit(
        isEdit ? 'roles.update' : 'roles.store',
        isEdit ? 'put' : 'post',
        {
            params: isEdit ? { role: roleId } : undefined,
            onSuccess: () => {
                onSaved?.();
                onOpenChange(false);
            },
        },
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden p-0 sm:max-w-6xl">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle className="text-xl">
                        {isEdit ? 'Sửa vai trò' : 'Thêm vai trò'}
                    </DialogTitle>
                </DialogHeader>

                <Form
                    form={form as any}
                    onSubmit={onSubmit}
                    className="flex flex-1 flex-col overflow-hidden"
                >
                    <div className="flex-1 space-y-4 overflow-y-auto px-6">
                        <Field
                            name="name"
                            ui="input"
                            label="Tên vai trò"
                            autoComplete="off"
                        />

                        {isAllSelected && (
                            <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
                                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                                <span>
                                    Bạn đã chọn tất cả quyền. Nếu muốn cấp quyền
                                    quản trị hệ thống toàn diện, vui lòng qua
                                    trang{' '}
                                    <Link
                                        href="/admins"
                                        className="font-medium underline"
                                    >
                                        Quản trị viên
                                    </Link>{' '}
                                    và tích chọn tùy chọn{' '}
                                    <strong>Super Admin</strong> thay vì gán vai
                                    trò này.
                                </span>
                            </div>
                        )}

                        {loading ? (
                            <div className="py-12 text-center text-sm text-muted-foreground">
                                Đang tải...
                            </div>
                        ) : (
                            <PermissionMatrix
                                groups={toPermissionGroups(groups, selected)}
                                onToggle={(groupKey, actionKey, checked) =>
                                    setValue(
                                        'permissions',
                                        togglePermission(
                                            selected,
                                            groupKey,
                                            actionKey,
                                            checked,
                                        ),
                                    )
                                }
                                onToggleGroup={(groupKey, checked) =>
                                    setValue(
                                        'permissions',
                                        toggleGroupPermissions(
                                            selected,
                                            groups[groupKey] ?? [],
                                            checked,
                                        ),
                                    )
                                }
                                onToggleAll={(checked) =>
                                    setValue(
                                        'permissions',
                                        checked
                                            ? Object.values(groups).flat()
                                            : [],
                                    )
                                }
                            />
                        )}
                    </div>

                    <DialogFooter className="border-t bg-muted/50 p-4 px-6">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                        >
                            Hủy
                        </Button>
                        <Button
                            type="submit"
                            disabled={isSubmitting || loading}
                        >
                            {isSubmitting ? 'Đang lưu...' : 'Lưu'}
                        </Button>
                    </DialogFooter>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
