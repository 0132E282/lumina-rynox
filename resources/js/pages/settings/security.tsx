import { Head } from '@inertiajs/react';
import {
    MailCheck,
    KeyRound,
    ShieldCheck,
    Fingerprint,
    LockKeyhole,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Form, Field } from '@/components/form';
import ManagePasskeys from '@/components/manage-passkeys';
import ManageTwoFactor from '@/components/manage-two-factor';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useAppForm, z } from '@/hooks/use-app-form';
import SettingsLayout from '@/layouts/settings/layout';
import type { Passkey } from '@/types';

const passwordSchema = z
    .object({
        current_password: z.string().min(1, 'Current password is required'),
        password: z.string().min(8, 'Password must be at least 8 characters'),
        password_confirmation: z
            .string()
            .min(1, 'Please confirm your password'),
    })
    .refine((data) => data.password === data.password_confirmation, {
        message: "Passwords don't match",
        path: ['password_confirmation'],
    });

type PasswordValues = z.infer<typeof passwordSchema>;

export default function Security({
    canManageTwoFactor,
    canManagePasskeys,
    passkeys,
    twoFactorEnabled,
    requiresConfirmation,
    isEmailVerified,
    email,
}: {
    canManageTwoFactor?: boolean;
    canManagePasskeys?: boolean;
    passkeys?: Passkey[];
    twoFactorEnabled?: boolean;
    requiresConfirmation?: boolean;
    isEmailVerified?: boolean;
    email?: string;
}) {
    const currentPasswordInput = useRef<HTMLInputElement>(null);
    const newPasswordInput = useRef<HTMLInputElement>(null);
    const [emailOtpEnabled, setEmailOtpEnabled] = useState(false);

    const form = useAppForm<PasswordValues>({
        schema: passwordSchema,
        defaultValues: {
            current_password: '',
            password: '',
            password_confirmation: '',
        },
    });

    const {
        formState: { isSubmitting, isSubmitSuccessful },
        reset,
    } = form;

    const onSubmit = form.submit('user-password.update', 'put', {
        onSuccess: () => reset(),
        onError: (errs) => {
            if (errs.password) {
                reset({ password: '', password_confirmation: '' });
                newPasswordInput.current?.focus();
            }

            if (errs.current_password) {
                reset({ current_password: '' });
                currentPasswordInput.current?.focus();
            }
        },
    });

    return (
        <SettingsLayout>
            <Head title="Security settings" />

            <div className="w-full max-w-4xl space-y-8 pb-10">
                <Card className="overflow-hidden border-border/60 shadow-sm transition-all duration-300 hover:border-blue-500/20 hover:shadow-md">
                    <CardHeader className="pb-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-xl bg-blue-500/10 p-2 text-blue-500 shadow-inner ring-1 ring-blue-500/20">
                                <LockKeyhole className="h-5 w-5" />
                            </div>
                            <div>
                                <CardTitle className="text-lg font-semibold">
                                    Update Password
                                </CardTitle>
                                <CardDescription className="mt-1 text-sm text-muted-foreground">
                                    Ensure your account is using a long, random
                                    password to stay secure.
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <Form
                            form={form as any}
                            onSubmit={onSubmit}
                            className="w-full"
                        >
                            <div className="w-full space-y-6 rounded-xl border border-border/50 bg-muted/20 p-5 transition-colors hover:bg-muted/40">
                                <Field
                                    name="current_password"
                                    ui="input"
                                    type="password"
                                    label="Current password"
                                    autoComplete="current-password"
                                    placeholder="Enter your current password"
                                />

                                <div className="grid grid-cols-1 gap-5 border-t border-border/60 pt-4 md:grid-cols-2">
                                    <Field
                                        name="password"
                                        ui="input"
                                        type="password"
                                        label="New password"
                                        autoComplete="new-password"
                                        placeholder="Min. 8 characters"
                                    />

                                    <Field
                                        name="password_confirmation"
                                        ui="input"
                                        type="password"
                                        label="Confirm password"
                                        autoComplete="new-password"
                                        placeholder="Re-enter password"
                                    />
                                </div>

                                <div className="flex items-center gap-4 pt-4">
                                    <Button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="h-9 w-full px-5 font-medium shadow-sm md:w-auto"
                                    >
                                        {isSubmitting
                                            ? 'Saving changes...'
                                            : 'Save Password'}
                                    </Button>

                                    {isSubmitSuccessful && (
                                        <p className="flex animate-in items-center gap-1.5 text-sm font-medium text-emerald-600 duration-300 fade-in slide-in-from-left-2 dark:text-emerald-400">
                                            <ShieldCheck className="h-4 w-4" />
                                            Saved successfully
                                        </p>
                                    )}
                                </div>
                            </div>
                        </Form>
                    </CardContent>
                </Card>

                {isEmailVerified && (
                    <Card className="overflow-hidden border-border/60 shadow-sm transition-all duration-300 hover:border-emerald-500/20 hover:shadow-md">
                        <CardHeader className="pb-4">
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-600 shadow-inner ring-1 ring-emerald-500/20 dark:text-emerald-400">
                                    <MailCheck className="h-5 w-5" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg font-semibold">
                                        Email Authentication
                                    </CardTitle>
                                    <CardDescription className="mt-1 text-sm text-muted-foreground">
                                        Receive a One-Time Password via email (
                                        {email}).
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="group flex flex-col items-start justify-between gap-5 rounded-xl border border-border/50 bg-muted/20 p-5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center">
                                <div className="flex max-w-xl flex-col gap-1">
                                    <span className="text-sm font-semibold text-foreground">
                                        Enable Email OTP Login
                                    </span>
                                    <span className="text-sm leading-relaxed text-muted-foreground">
                                        Secure your account with 6-digit codes
                                        sent directly to your inbox. This
                                        provides strong security without needing
                                        a dedicated authenticator app.
                                    </span>
                                </div>
                                <Switch
                                    className="shadow-sm data-[state=checked]:bg-emerald-500"
                                    checked={emailOtpEnabled}
                                    onCheckedChange={setEmailOtpEnabled}
                                    aria-label="Toggle Email OTP"
                                />
                            </div>
                        </CardContent>
                    </Card>
                )}

                {canManageTwoFactor && (
                    <Card className="overflow-hidden border-border/60 shadow-sm transition-all duration-300 hover:border-purple-500/20 hover:shadow-md">
                        <CardHeader className="pb-4">
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-purple-500/10 p-2 text-purple-600 shadow-inner ring-1 ring-purple-500/20 dark:text-purple-400">
                                    <ShieldCheck className="h-5 w-5" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg font-semibold">
                                        Two-factor Authentication
                                    </CardTitle>
                                    <CardDescription className="mt-1 text-sm text-muted-foreground">
                                        Add an extra layer of defense to your
                                        account using an authenticator app.
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-xl border border-border/50 bg-muted/20 p-5 transition-colors hover:bg-muted/40">
                                <ManageTwoFactor
                                    canManageTwoFactor={canManageTwoFactor}
                                    twoFactorEnabled={twoFactorEnabled}
                                    requiresConfirmation={requiresConfirmation}
                                />
                            </div>
                        </CardContent>
                    </Card>
                )}

                {canManagePasskeys && (
                    <Card className="overflow-hidden border-border/60 shadow-sm transition-all duration-300 hover:border-amber-500/20 hover:shadow-md">
                        <CardHeader className="pb-4">
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-amber-500/10 p-2 text-amber-600 shadow-inner ring-1 ring-amber-500/20 dark:text-amber-400">
                                    <Fingerprint className="h-5 w-5" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg font-semibold">
                                        Passkeys
                                    </CardTitle>
                                    <CardDescription className="mt-1 text-sm text-muted-foreground">
                                        Passwordless, seamless sign-in using
                                        your device's built-in biometrics.
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-xl border border-border/50 bg-muted/20 p-5 transition-colors hover:bg-muted/40">
                                <ManagePasskeys
                                    canManagePasskeys={canManagePasskeys}
                                    passkeys={passkeys}
                                />
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </SettingsLayout>
    );
}
