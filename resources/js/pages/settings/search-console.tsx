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

const searchConsoleSchema = z.object({
    site_url: z.string().optional().nullable(),
    credentials: z.any().optional().nullable(),
});

type SearchConsoleValues = z.infer<typeof searchConsoleSchema>;

interface Setting {
    site_url: string | null;
    has_credentials: boolean;
}

export default function SearchConsoleSettings({
    setting,
}: {
    setting: Setting;
}) {
    const form = useAppForm<SearchConsoleValues>({
        schema: searchConsoleSchema,
        defaultValues: {
            site_url: setting.site_url ?? '',
            credentials: null,
        },
    });

    const {
        formState: { isSubmitting, isSubmitSuccessful },
    } = form;

    const onSubmit = form.submit('search-console.update', 'patch', {});

    return (
        <SystemSettingsLayout>
            <Head title="Google Search Console" />

            <Card>
                <CardHeader>
                    <CardTitle>Google Search Console</CardTitle>
                    <CardDescription>
                        Dùng để kiểm tra trạng thái index thật của trang trên
                        Google. Cần một service account đã được thêm làm người
                        dùng trên property Search Console của trang frontend.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form
                        form={form as any}
                        onSubmit={onSubmit}
                        className="max-w-full"
                    >
                        <Field
                            name="site_url"
                            ui="input"
                            label="Property URL"
                            placeholder="https://vietnamsolar.com.vn/"
                            description="Phải khớp chính xác với property đã xác minh trong Search Console (kể cả dấu / cuối)."
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
                                    : 'Tải lên file JSON key của service account (từ Google Cloud Console).'
                            }
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
