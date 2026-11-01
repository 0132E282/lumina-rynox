import { router } from '@inertiajs/react';
import { usePasskeyVerify } from '@laravel/passkeys/react';
import { Fingerprint } from 'lucide-react';
import { Form, Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    Field as UIField,
    FieldDescription,
    FieldSeparator,
} from '@/components/ui/field';
import { useAppForm, z } from '@/hooks/use-app-form';
import { GoogleIcon, MetaIcon } from '@/icons';

const loginSchema = z.object({
    email: z.string().email('Vui lòng nhập địa chỉ email hợp lệ'),
    password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
    const form = useAppForm<LoginValues>({
        schema: loginSchema,
        defaultValues: {
            email: '',
            password: '',
        },
    });

    const {
        formState: { isSubmitting },
    } = form;

    const onSubmit = form.handleSubmit((data) => {
        router.post('/login', data, {
            onError: (errors) => {
                Object.entries(errors).forEach(([key, message]) => {
                    form.setError(key as keyof LoginValues, {
                        type: 'server',
                        message: message as string,
                    });
                });
            },
        });
    });

    const {
        verify,
        isLoading: isVerifyingPasskey,
        error: passkeyError,
        isSupported: isPasskeySupported,
    } = usePasskeyVerify({
        onSuccess: (response) => {
            window.location.href = response.redirect ?? '/';
        },
    });

    return (
        <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
            <div className="w-full max-w-sm md:max-w-4xl">
                <Card className="overflow-hidden p-0 shadow-lg">
                    <CardContent className="grid p-0 md:grid-cols-2">
                        <Form
                            className="p-6 md:p-8"
                            form={form}
                            onSubmit={onSubmit}
                        >
                            <div className="mb-2 flex w-full flex-col items-center gap-2 text-center">
                                <h1 className="text-2xl font-bold text-gray-800">
                                    Welcome back
                                </h1>
                                <p className="text-sm text-balance text-gray-600">
                                    Login to your account
                                </p>
                            </div>

                            <Field
                                name="email"
                                ui="input"
                                type="email"
                                label="Email"
                                placeholder="m@example.com"
                                className="mb-4"
                            />

                            <Field
                                name="password"
                                ui="input"
                                type="password"
                                label="Password"
                                className="mb-4"
                            />

                            <UIField className="pt-2">
                                <Button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full"
                                >
                                    {isSubmitting
                                        ? 'Đang đăng nhập...'
                                        : 'Login'}
                                </Button>
                            </UIField>

                            {isPasskeySupported && (
                                <UIField className="pt-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="flex w-full items-center justify-center gap-2"
                                        disabled={isVerifyingPasskey}
                                        onClick={() => verify()}
                                    >
                                        <Fingerprint className="h-5 w-5" />
                                        {isVerifyingPasskey
                                            ? 'Đang xác thực...'
                                            : 'Đăng nhập bằng passkey'}
                                    </Button>
                                    {passkeyError && (
                                        <p className="mt-1 text-center text-sm text-destructive">
                                            {passkeyError}
                                        </p>
                                    )}
                                </UIField>
                            )}

                            <FieldSeparator className="my-2 *:data-[slot=field-separator-content]:bg-card">
                                Or continue with
                            </FieldSeparator>

                            <UIField className="grid grid-cols-2 gap-4">
                                <Button
                                    variant="outline"
                                    type="button"
                                    className="flex items-center justify-center gap-2"
                                >
                                    <GoogleIcon className="h-5 w-5" />
                                    <span className="font-medium">Google</span>
                                </Button>
                                <Button
                                    variant="outline"
                                    type="button"
                                    className="flex items-center justify-center gap-2"
                                >
                                    <MetaIcon className="h-5 w-5" />
                                    <span className="font-medium">
                                        Facebook
                                    </span>
                                </Button>
                            </UIField>

                            <FieldDescription className="mt-2 text-center">
                                <a
                                    href="/forgot-password"
                                    className="hover:underline"
                                >
                                    Quên mật khẩu?
                                </a>
                            </FieldDescription>
                        </Form>
                        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-8 md:flex">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.08),_transparent_60%)]" />
                            <div className="absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
                            <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />

                            <div className="relative z-10 flex items-center gap-2 text-white">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 backdrop-blur">
                                    <Fingerprint className="h-5 w-5" />
                                </div>
                                <span className="text-lg font-semibold">
                                    Lumina CMS
                                </span>
                            </div>

                            <div className="relative z-10 flex flex-1 items-center justify-center py-6">
                                <svg
                                    viewBox="0 0 320 220"
                                    className="w-full max-w-[280px] drop-shadow-2xl"
                                >
                                    <rect
                                        x="0"
                                        y="0"
                                        width="320"
                                        height="220"
                                        rx="12"
                                        fill="#18181b"
                                        stroke="rgba(255,255,255,0.08)"
                                    />
                                    <rect
                                        x="0"
                                        y="0"
                                        width="72"
                                        height="220"
                                        rx="12"
                                        fill="#0f0f11"
                                    />
                                    <circle
                                        cx="26"
                                        cy="24"
                                        r="6"
                                        fill="#a78bfa"
                                    />
                                    <rect
                                        x="14"
                                        y="48"
                                        width="44"
                                        height="8"
                                        rx="4"
                                        fill="rgba(255,255,255,0.5)"
                                    />
                                    <rect
                                        x="14"
                                        y="68"
                                        width="44"
                                        height="8"
                                        rx="4"
                                        fill="rgba(255,255,255,0.18)"
                                    />
                                    <rect
                                        x="14"
                                        y="88"
                                        width="44"
                                        height="8"
                                        rx="4"
                                        fill="rgba(255,255,255,0.18)"
                                    />
                                    <rect
                                        x="14"
                                        y="108"
                                        width="44"
                                        height="8"
                                        rx="4"
                                        fill="rgba(255,255,255,0.18)"
                                    />

                                    <rect
                                        x="88"
                                        y="18"
                                        width="216"
                                        height="34"
                                        rx="8"
                                        fill="rgba(255,255,255,0.06)"
                                    />
                                    <circle
                                        cx="290"
                                        cy="35"
                                        r="10"
                                        fill="#a78bfa"
                                    />

                                    <rect
                                        x="88"
                                        y="66"
                                        width="66"
                                        height="46"
                                        rx="8"
                                        fill="rgba(167,139,250,0.18)"
                                        stroke="rgba(167,139,250,0.4)"
                                    />
                                    <rect
                                        x="98"
                                        y="76"
                                        width="30"
                                        height="6"
                                        rx="3"
                                        fill="#a78bfa"
                                    />
                                    <rect
                                        x="98"
                                        y="88"
                                        width="42"
                                        height="10"
                                        rx="3"
                                        fill="rgba(255,255,255,0.7)"
                                    />

                                    <rect
                                        x="166"
                                        y="66"
                                        width="66"
                                        height="46"
                                        rx="8"
                                        fill="rgba(255,255,255,0.06)"
                                    />
                                    <rect
                                        x="176"
                                        y="76"
                                        width="30"
                                        height="6"
                                        rx="3"
                                        fill="rgba(255,255,255,0.4)"
                                    />
                                    <rect
                                        x="176"
                                        y="88"
                                        width="42"
                                        height="10"
                                        rx="3"
                                        fill="rgba(255,255,255,0.7)"
                                    />

                                    <rect
                                        x="244"
                                        y="66"
                                        width="60"
                                        height="46"
                                        rx="8"
                                        fill="rgba(255,255,255,0.06)"
                                    />
                                    <rect
                                        x="254"
                                        y="76"
                                        width="30"
                                        height="6"
                                        rx="3"
                                        fill="rgba(255,255,255,0.4)"
                                    />
                                    <rect
                                        x="254"
                                        y="88"
                                        width="34"
                                        height="10"
                                        rx="3"
                                        fill="rgba(255,255,255,0.7)"
                                    />

                                    <rect
                                        x="88"
                                        y="126"
                                        width="216"
                                        height="78"
                                        rx="8"
                                        fill="rgba(255,255,255,0.05)"
                                    />
                                    <polyline
                                        points="98,180 122,160 146,172 170,140 194,150 218,124 242,146 266,132 290,150"
                                        fill="none"
                                        stroke="#a78bfa"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    <polyline
                                        points="98,196 122,190 146,194 170,182 194,188 218,176 242,184 266,178 290,184"
                                        fill="none"
                                        stroke="rgba(255,255,255,0.25)"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </div>

                            <div className="relative z-10 space-y-2 text-white">
                                <h2 className="text-2xl leading-tight font-semibold">
                                    Quản lý nội dung dễ dàng, mọi lúc mọi nơi.
                                </h2>
                                <p className="text-sm text-white/70">
                                    Đăng nhập để tiếp tục quản lý trang web của
                                    bạn.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
