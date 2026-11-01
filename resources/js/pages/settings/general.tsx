import { Head } from '@inertiajs/react';
import { Field, Form } from '@/components/form';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { useAppForm, z } from '@/hooks/use-app-form';
import SystemSettingsLayout from '@/layouts/system-settings-layout';

const generalSchema = z.object({
    site_name: z.string().optional().nullable(),
    logo: z.string().optional().nullable(),
    favicon: z.string().optional().nullable(),
});

type GeneralValues = z.infer<typeof generalSchema>;

interface Setting {
    site_name: string | null;
    logo_url: string | null;
    favicon_url: string | null;
}

export default function GeneralSettings({ setting }: { setting: Setting }) {
    const form = useAppForm<GeneralValues>({
        schema: generalSchema,
        defaultValues: {
            site_name: setting.site_name ?? '',
            logo: setting.logo_url ?? '',
            favicon: setting.favicon_url ?? '',
        },
    });

    const {
        formState: { isSubmitting, isSubmitSuccessful },
    } = form;

    const onSubmit = form.submit('general.update', 'patch', {});

    return (
        <SystemSettingsLayout>
            <Head title="Cấu hình hệ thống" />

            <Card>
                <CardHeader>
                    <CardTitle>Thương hiệu</CardTitle>
                    <CardDescription>
                        Tên website, logo và favicon hiển thị trên toàn hệ
                        thống.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form
                        form={form as any}
                        onSubmit={onSubmit}
                        className="max-w-full"
                    >
                        <Field
                            name="site_name"
                            ui="input"
                            label="Tên website"
                        />

                        <Field
                            className="mt-4"
                            name="logo"
                            ui="attachment"
                            accept="image/*"
                            source="system,manager"
                            label="Logo"
                        />

                        <Field
                            className="mt-4"
                            name="favicon"
                            ui="attachment"
                            accept="image/*"
                            source="system,manager"
                            label="Favicon"
                        />

                        <div className="mt-6 flex items-center gap-4">
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? 'Đang lưu...' : 'Lưu'}
                            </Button>

                            {isSubmitSuccessful && (
                                <p className="animate-in text-sm text-muted-foreground fade-in">
                                    Đã lưu
                                </p>
                            )}
                        </div>
                    </Form>
                </CardContent>
            </Card>
        </SystemSettingsLayout>
    );
}
