import { Head, usePage } from '@inertiajs/react';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { send } from '@/routes/verification';
import { Form, Field } from '@/components/form';
import TextLink from '@/components/text-link';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { useAppForm, z } from '@/hooks/use-app-form';
import SettingsLayout from '@/layouts/settings/layout';
import type { Auth } from '@/types';

const profileSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email address'),
    phone: z.string().optional().nullable(),
    profile_url: z.string().optional().nullable(),
});

type ProfileValues = z.infer<typeof profileSchema>;

export default function Profile({
    mustVerifyEmail,
    status,
}: {
    mustVerifyEmail: boolean;
    status?: string;
}) {
    const { auth } = usePage<{
        auth: Auth & {
            user: {
                phone?: string | null;
                profile_url?: string | null;
                phone_verified_at?: string | null;
            };
        };
    }>().props;

    const [otpOpen, setOtpOpen] = useState(false);
    const [otpType, setOtpType] = useState<'email' | 'phone' | null>(null);

    const handleVerifyClick = (type: 'email' | 'phone') => {
        setOtpType(type);
        setOtpOpen(true);
    };

    const form = useAppForm<ProfileValues>({
        schema: profileSchema,
        defaultValues: {
            name: auth.user.name,
            email: auth.user.email,
            phone: auth.user.phone || '',
            profile_url: auth.user.profile_url || '',
        },
    });

    const {
        formState: { isSubmitting, isSubmitSuccessful },
    } = form;

    const onSubmit = form.submit('profile.update', 'patch', {});

    return (
        <SettingsLayout>
            <Head title="Profile settings" />

            <div className="max-w-full space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Profile information</CardTitle>
                        <CardDescription>
                            Update your name, email address, and phone number
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Form
                            form={form as any}
                            onSubmit={onSubmit}
                            className="max-w-full"
                        >
                            <Field
                                className="mt-2"
                                name="profile_url"
                                ui="attachment"
                                accept="image/*"
                                source="system"
                                label="Ảnh đại diện"
                            />
                            <Field
                                name="name"
                                ui="input"
                                label="Name"
                                autoComplete="name"
                            />

                            <div className="mt-2 flex items-end gap-2">
                                <div className="relative min-w-0 flex-1">
                                    <Field
                                        className={`mt-0 ${auth.user.email_verified_at ? '[&_[data-slot=input]]:pr-10' : ''}`}
                                        name="email"
                                        ui="input"
                                        type="email"
                                        label="Email address"
                                        autoComplete="email"
                                    />
                                    {auth.user.email_verified_at && (
                                        <div
                                            className="absolute top-[38px] right-3"
                                            title="Đã xác thực"
                                        >
                                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                                        </div>
                                    )}
                                </div>
                                {!auth.user.email_verified_at && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-9"
                                        onClick={() =>
                                            handleVerifyClick('email')
                                        }
                                    >
                                        Xác thực
                                    </Button>
                                )}
                            </div>

                            <div className="mt-2 flex items-end gap-2">
                                <div className="relative min-w-0 flex-1">
                                    <Field
                                        className={`mt-0 ${auth.user.phone_verified_at ? '[&_[data-slot=input]]:pr-10' : ''}`}
                                        name="phone"
                                        ui="input"
                                        type="tel"
                                        label="Phone number"
                                        autoComplete="tel"
                                    />
                                    {auth.user.phone_verified_at && (
                                        <div
                                            className="absolute top-[38px] right-3"
                                            title="Đã xác thực"
                                        >
                                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                                        </div>
                                    )}
                                </div>
                                {!auth.user.phone_verified_at && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-9"
                                        onClick={() =>
                                            handleVerifyClick('phone')
                                        }
                                    >
                                        Xác thực
                                    </Button>
                                )}
                            </div>

                            {mustVerifyEmail &&
                                auth.user.email_verified_at === null && (
                                    <div className="mt-4">
                                        <p className="text-sm text-muted-foreground">
                                            Your email address is unverified.{' '}
                                            <TextLink href={send()} as="button">
                                                Click here to resend the
                                                verification email.
                                            </TextLink>
                                        </p>

                                        {status ===
                                            'verification-link-sent' && (
                                            <p className="mt-2 text-sm font-medium text-green-600">
                                                A new verification link has been
                                                sent to your email address.
                                            </p>
                                        )}
                                    </div>
                                )}

                            <div className="mt-6 flex items-center gap-4">
                                <Button type="submit" disabled={isSubmitting}>
                                    {isSubmitting ? 'Saving...' : 'Save'}
                                </Button>

                                {isSubmitSuccessful && (
                                    <p className="animate-in text-sm text-muted-foreground fade-in">
                                        Saved
                                    </p>
                                )}
                            </div>
                        </Form>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={otpOpen} onOpenChange={setOtpOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            Xác thực{' '}
                            {otpType === 'email' ? 'Email' : 'Số điện thoại'}
                        </DialogTitle>
                        <DialogDescription>
                            Nhập mã OTP 6 số đã được gửi đến{' '}
                            {otpType === 'email' ? 'email' : 'số điện thoại'}{' '}
                            của bạn.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-center py-6">
                        <Field name="otp" ui="otp" maxLength={6} />
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setOtpOpen(false)}
                        >
                            Hủy
                        </Button>
                        <Button onClick={() => setOtpOpen(false)}>
                            Xác nhận
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </SettingsLayout>
    );
}
