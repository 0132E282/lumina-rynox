import { Head } from '@inertiajs/react';
import { Form, Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useAppForm, z } from '@/hooks/use-app-form';

const confirmPasswordSchema = z.object({
    password: z.string().min(1, 'Password is required'),
});

type ConfirmPasswordValues = z.infer<typeof confirmPasswordSchema>;

export default function ConfirmPassword() {
    const form = useAppForm<ConfirmPasswordValues>({
        schema: confirmPasswordSchema,
        defaultValues: {
            password: '',
        },
    });

    const {
        formState: { isSubmitting },
    } = form;

    const onSubmit = form.submit('/user/confirm-password', 'post');

    return (
        <>
            <Head title="Confirm Password" />
            <Dialog open>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>Confirm Password</DialogTitle>
                        <DialogDescription>
                            This is a secure area of the application. Please
                            confirm your password before continuing.
                        </DialogDescription>
                    </DialogHeader>

                    <Form form={form} onSubmit={onSubmit} className="space-y-4">
                        <Field
                            name="password"
                            ui="input"
                            type="password"
                            label="Password"
                            autoComplete="current-password"
                            autoFocus
                        />

                        <Button disabled={isSubmitting} className="w-full">
                            {isSubmitting
                                ? 'Confirming...'
                                : 'Confirm Password'}
                        </Button>
                    </Form>
                </DialogContent>
            </Dialog>
        </>
    );
}
