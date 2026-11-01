import { useRef, useState } from 'react';
import { Form, Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from '@/components/ui/card';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { useAppForm, z } from '@/hooks/use-app-form';

const deleteUserSchema = z.object({
    password: z.string().min(1, 'Password is required to confirm deletion.'),
    email: z.string().email('Invalid email address'),
    phone: z.string().min(1, 'Phone is required').optional().nullable(),
});

type DeleteUserValues = z.infer<typeof deleteUserSchema>;

export default function DeleteUser() {
    const passwordInput = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);

    const form = useAppForm<DeleteUserValues>({
        schema: deleteUserSchema,
        defaultValues: {
            password: '',
            email: '',
            phone: '',
        },
    });

    const {
        formState: { isSubmitting },
        reset,
    } = form;

    const onSubmit = form.submit('profile.destroy', 'delete', {
        onSuccess: () => {
            // ! Hard navigation: an Inertia visit would reuse the destroyed session's CSRF token.
            window.location.href = '/';
        },
        onError: () => passwordInput.current?.focus(),
    });

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);

        if (!newOpen) {
            reset();
        }
    };

    return (
        <Card className="border-destructive/50 bg-destructive/5">
            <CardHeader>
                <CardTitle className="text-destructive">
                    Delete account
                </CardTitle>
            </CardHeader>
            <CardContent>
                <Dialog open={open} onOpenChange={handleOpenChange}>
                    <DialogTrigger asChild>
                        <Button
                            variant="destructive"
                            data-test="delete-user-button"
                        >
                            Delete account
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogTitle>
                            Are you sure you want to delete your account?
                        </DialogTitle>
                        <DialogDescription>
                            Once your account is deleted, all of its resources
                            and data will also be permanently deleted. Please
                            enter your password to confirm you would like to
                            permanently delete your account.
                        </DialogDescription>

                        <Form
                            form={form as any}
                            onSubmit={onSubmit}
                            className="mt-4 space-y-6"
                        >
                            <Field
                                name="password"
                                ui="input"
                                type="password"
                                placeholder="Password"
                                autoComplete="current-password"
                            />

                            <Field
                                name="email"
                                ui="input"
                                type="email"
                                placeholder="Email address"
                                autoComplete="email"
                            />

                            <Field
                                name="phone"
                                ui="input"
                                type="tel"
                                placeholder="Phone number"
                                autoComplete="tel"
                            />

                            <DialogFooter className="mt-6 gap-2">
                                <DialogClose asChild>
                                    <Button variant="secondary" type="button">
                                        Cancel
                                    </Button>
                                </DialogClose>

                                <Button
                                    variant="destructive"
                                    type="submit"
                                    disabled={isSubmitting}
                                    data-test="confirm-delete-user-button"
                                >
                                    {isSubmitting
                                        ? 'Deleting...'
                                        : 'Delete account'}
                                </Button>
                            </DialogFooter>
                        </Form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
}
