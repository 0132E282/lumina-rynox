import { Head } from '@inertiajs/react';
import { ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Form, Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAppForm, z } from '@/hooks/use-app-form';

const twoFactorSchema = z.object({
    code: z.string().optional(),
    recovery_code: z.string().optional(),
});

type TwoFactorValues = z.infer<typeof twoFactorSchema>;

export default function TwoFactorChallenge() {
    const [recovery, setRecovery] = useState(false);

    const form = useAppForm<TwoFactorValues>({
        schema: twoFactorSchema,
        defaultValues: {
            code: '',
            recovery_code: '',
        },
    });

    const {
        formState: { isSubmitting, errors },
        setValue,
    } = form;
    const formError = errors.code?.message ?? errors.recovery_code?.message;
    const recoveryCodeInputRef = useRef<HTMLInputElement>(null);

    const toggleRecovery = (e: MouseEvent) => {
        e.preventDefault();
        const isRecovery = !recovery;
        setRecovery(isRecovery);

        if (isRecovery) {
            setValue('code', '');
            setTimeout(() => recoveryCodeInputRef.current?.focus(), 100);
        } else {
            setValue('recovery_code', '');
        }
    };

    const onSubmit = form.submit('/two-factor-challenge', 'post');

    // * Registered manually to attach a ref for focus management.
    const recoveryCodeRegister = form.register('recovery_code');

    return (
        <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
            <div className="w-full max-w-sm">
                <Head title="Two-factor Confirmation" />

                <Card className="overflow-hidden border-border/60 shadow-sm">
                    <CardContent className="p-6 md:p-8">
                        <div className="mb-6 flex flex-col items-center gap-3 text-center">
                            <div className="rounded-xl bg-purple-500/10 p-3 text-purple-600 shadow-inner ring-1 ring-purple-500/20 dark:text-purple-400">
                                <ShieldCheck className="size-6" />
                            </div>
                            <h1 className="text-lg font-semibold">
                                Two-Factor Authentication
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                {!recovery
                                    ? 'Enter the authentication code provided by your authenticator app to confirm access to your account.'
                                    : 'Enter one of your emergency recovery codes to confirm access to your account.'}
                            </p>
                        </div>

                        <Form form={form} onSubmit={onSubmit}>
                            {!recovery ? (
                                <div className="flex flex-col items-center gap-4">
                                    <span className="text-sm font-medium">
                                        Authenticator code
                                    </span>
                                    <Field
                                        name="code"
                                        ui="otp"
                                        maxLength={6}
                                        showError={false}
                                    />
                                </div>
                            ) : (
                                <Field
                                    name="recovery_code"
                                    ui="input"
                                    type="text"
                                    label="Recovery code"
                                    autoComplete="off"
                                    autoFocus
                                    placeholder="Enter a recovery code"
                                    showError={false}
                                    registerFn={() => ({
                                        ...recoveryCodeRegister,
                                        ref: (e: HTMLInputElement) => {
                                            recoveryCodeRegister.ref(e);
                                            recoveryCodeInputRef.current = e;
                                        },
                                    })}
                                />
                            )}

                            {formError && (
                                <p className="mt-3 text-center text-sm text-destructive">
                                    {formError}
                                </p>
                            )}

                            <div className="mt-6 flex flex-col gap-4">
                                <Button
                                    disabled={isSubmitting}
                                    className="w-full"
                                >
                                    {isSubmitting ? 'Verifying...' : 'Log in'}
                                </Button>
                                <div className="flex justify-center">
                                    <button
                                        type="button"
                                        className="text-sm font-medium text-muted-foreground underline transition-colors hover:text-foreground"
                                        onClick={toggleRecovery}
                                    >
                                        {!recovery
                                            ? 'Use a recovery code'
                                            : 'Use an authentication code'}
                                    </button>
                                </div>
                            </div>
                        </Form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
