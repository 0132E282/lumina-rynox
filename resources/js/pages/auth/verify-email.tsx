import { Head, Link } from '@inertiajs/react';
import { Form } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAppForm, z } from '@/hooks/use-app-form';

export default function VerifyEmail({ status }: { status?: string }) {
    const form = useAppForm({ schema: z.object({}) });
    const {
        formState: { isSubmitting },
    } = form;

    const onSubmit = form.submit('/email/verification-notification', 'post');

    return (
        <div className="flex flex-col items-center justify-center p-6 md:p-10">
            <div className="w-full max-w-md">
                <Head title="Email Verification" />

                <Card className="overflow-hidden p-0">
                    <CardContent className="p-0">
                        <Form
                            form={form}
                            onSubmit={onSubmit}
                            className="p-6 md:p-8"
                        >
                            <div className="mb-4 text-center text-sm text-muted-foreground">
                                Thanks for signing up! Before getting started,
                                could you verify your email address by clicking
                                on the link we just emailed to you? If you
                                didn't receive the email, we will gladly send
                                you another.
                            </div>

                            {status === 'verification-link-sent' && (
                                <div className="mb-4 rounded-md border border-green-500/20 bg-green-500/10 p-3 text-center text-sm font-medium text-green-600">
                                    A new verification link has been sent to the
                                    email address you provided during
                                    registration.
                                </div>
                            )}

                            <div className="mt-6 flex flex-col items-center justify-center gap-4">
                                <Button
                                    disabled={isSubmitting}
                                    className="w-full"
                                >
                                    {isSubmitting
                                        ? 'Resending...'
                                        : 'Resend Verification Email'}
                                </Button>

                                <Link
                                    href="/logout"
                                    method="post"
                                    as="button"
                                    className="text-sm font-medium text-muted-foreground underline transition-colors hover:text-foreground"
                                >
                                    Log Out
                                </Link>
                            </div>
                        </Form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
