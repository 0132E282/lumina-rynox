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

const settingsSchema = z.object({
    property_id: z.string().optional().nullable(),
    credentials: z
        .custom<File | null>(
            (value) =>
                value === null ||
                (typeof File !== 'undefined' && value instanceof File),
        )
        .optional(),
});

type SettingsValues = z.infer<typeof settingsSchema>;

interface GoogleAnalyticsSetting {
    property_id: string | null;
    has_credentials: boolean;
}

export default function GoogleAnalyticsSettings({
    setting,
}: {
    setting: GoogleAnalyticsSetting;
}) {
    const form = useAppForm<SettingsValues>({
        schema: settingsSchema,
        defaultValues: {
            property_id: setting.property_id ?? '',
            credentials: null,
        },
    });

    const {
        formState: { isSubmitting, isSubmitSuccessful },
    } = form;

    const onSubmit = form.submit('google-analytics.update', 'patch', {});

    return (
        <SystemSettingsLayout>
            <Head title="Google Analytics" />

            <Card>
                <CardHeader>
                    <CardTitle>Google Analytics</CardTitle>
                    <CardDescription>
                        Kết nối Google Analytics 4 để xem khách truy cập, lượt
                        xem trang, nguồn truy cập và thiết bị ngay trên trang
                        tổng quan.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form form={form} onSubmit={onSubmit}>
                        <Field
                            name="property_id"
                            ui="input"
                            label="GA4 Property ID"
                            placeholder="123456789"
                            description="Nhập Property ID dạng số trong Google Analytics Admin."
                        />

                        <Field
                            className="mt-4"
                            name="credentials"
                            ui="attachment"
                            accept="application/json"
                            source="system"
                            label="Service account JSON key"
                            description={
                                setting.has_credentials
                                    ? 'Đã tải lên một key — chọn file khác để thay thế.'
                                    : 'Tải JSON key của service account có quyền Viewer trên GA4 property.'
                            }
                        />

                        <div className="mt-6 flex items-center gap-4">
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? 'Đang lưu...' : 'Lưu'}
                            </Button>
                            {isSubmitSuccessful && (
                                <p className="text-sm text-muted-foreground">
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
