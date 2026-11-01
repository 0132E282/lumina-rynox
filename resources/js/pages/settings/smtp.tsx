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

const smtpSchema = z.object({
    mail_host: z.string().optional().nullable(),
    mail_port: z.string().optional().nullable(),
    mail_username: z.string().optional().nullable(),
    mail_password: z.string().optional().nullable(),
    mail_encryption: z.string().optional().nullable(),
    mail_from_address: z.string().optional().nullable(),
    mail_from_name: z.string().optional().nullable(),
});

type SmtpValues = z.infer<typeof smtpSchema>;

interface Setting {
    mail_host: string | null;
    mail_port: number | null;
    mail_username: string | null;
    mail_encryption: string | null;
    mail_from_address: string | null;
    mail_from_name: string | null;
    has_password: boolean;
}

export default function SmtpSettings({ setting }: { setting: Setting }) {
    const form = useAppForm<SmtpValues>({
        schema: smtpSchema,
        defaultValues: {
            mail_host: setting.mail_host ?? '',
            mail_port: setting.mail_port ? String(setting.mail_port) : '',
            mail_username: setting.mail_username ?? '',
            mail_password: '',
            mail_encryption: setting.mail_encryption ?? '',
            mail_from_address: setting.mail_from_address ?? '',
            mail_from_name: setting.mail_from_name ?? '',
        },
    });

    const {
        formState: { isSubmitting, isSubmitSuccessful },
    } = form;

    const onSubmit = form.submit('smtp.update', 'patch', {});

    return (
        <SystemSettingsLayout>
            <Head title="Cấu hình SMTP" />

            <Card>
                <CardHeader>
                    <CardTitle>SMTP</CardTitle>
                    <CardDescription>
                        Cấu hình máy chủ gửi email cho hệ thống.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form
                        form={form as any}
                        onSubmit={onSubmit}
                        className="max-w-full"
                    >
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field
                                name="mail_host"
                                ui="input"
                                label="SMTP Host"
                            />
                            <Field
                                name="mail_port"
                                ui="input"
                                type="number"
                                label="Port"
                            />
                            <Field
                                name="mail_username"
                                ui="input"
                                label="Username"
                            />
                            <Field
                                name="mail_password"
                                ui="input"
                                type="password"
                                label="Password"
                                placeholder={
                                    setting.has_password
                                        ? 'Để trống nếu không đổi'
                                        : ''
                                }
                            />
                            <Field
                                name="mail_encryption"
                                ui="input"
                                label="Encryption (tls/ssl)"
                            />
                            <Field
                                name="mail_from_address"
                                ui="input"
                                type="email"
                                label="From address"
                            />
                        </div>

                        <Field
                            className="mt-4"
                            name="mail_from_name"
                            ui="input"
                            label="From name"
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
