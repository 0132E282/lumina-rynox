import { usePage } from '@inertiajs/react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Field } from '@/components/form';
import FormLayout, { Section, Sidebar } from '@/layouts/form-layout';
import type { Admin, Role } from '@/types';

export default function AdminForm() {
    const { admin, roles } = usePage<{ admin: Admin | null; roles: Role[] }>()
        .props;
    const isEdit = admin !== null;

    return (
        <FormLayout title={isEdit ? 'Sửa quản trị viên' : 'Thêm quản trị viên'}>
            <Section withSidebar>
                <Field
                    name="name"
                    ui="input"
                    label="Tên"
                    validate="min:1:Tên là bắt buộc"
                />
                <Field
                    name="email"
                    ui="input"
                    type="email"
                    label="Email"
                    validate="email:Email không hợp lệ"
                />
                <Field
                    name="phone"
                    ui="input"
                    type="tel"
                    label="Điện thoại"
                    autoComplete="tel"
                />
                <Field
                    name="password"
                    ui="input"
                    type="password"
                    label={
                        isEdit
                            ? 'Mật khẩu mới (để trống nếu không đổi)'
                            : 'Mật khẩu'
                    }
                    autoComplete="new-password"
                />
            </Section>

            <Sidebar title="Ảnh & phân quyền">
                <Field
                    name="avatar"
                    ui="attachment"
                    accept="image/*"
                    source="system"
                    label="Ảnh đại diện"
                    default={admin?.profile_url ?? ''}
                />
                <Field
                    name="status"
                    ui="select"
                    label="Trạng thái"
                    default="active"
                >
                    <option value="active">Hoạt động</option>
                    <option value="locked">Bị khóa</option>
                </Field>

                <Field
                    name="system_admin"
                    ui="input"
                    default={false}
                    className="hidden"
                />

                <PermissionFields roles={roles} />
            </Sidebar>
        </FormLayout>
    );
}

function PermissionFields({ roles }: { roles: Role[] }) {
    const { control, setValue } = useFormContext();
    const isSystemAdmin = useWatch({ control, name: 'system_admin' });

    return (
        <div className="space-y-3">
            <p className="text-sm font-medium">Phân quyền</p>

            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input
                    type="radio"
                    className="mt-1"
                    checked={!!isSystemAdmin}
                    onChange={() =>
                        setValue('system_admin', true, { shouldDirty: true })
                    }
                />
                <span>
                    <span className="block font-medium">Super Admin</span>
                    <span className="block text-muted-foreground">
                        Toàn quyền trên toàn hệ thống, không cần chọn vai trò.
                    </span>
                </span>
            </label>

            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input
                    type="radio"
                    className="mt-1"
                    checked={!isSystemAdmin}
                    onChange={() =>
                        setValue('system_admin', false, { shouldDirty: true })
                    }
                />
                <span>
                    <span className="block font-medium">Theo vai trò</span>
                    <span className="block text-muted-foreground">
                        Chỉ có các quyền được cấp bởi vai trò đã chọn bên dưới.
                    </span>
                </span>
            </label>

            {!isSystemAdmin && (
                <Field name="role_id" ui="select" label="Vai trò" default="">
                    <option value="">— Chưa chọn —</option>
                    {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                            {role.name}
                        </option>
                    ))}
                </Field>
            )}
        </div>
    );
}
