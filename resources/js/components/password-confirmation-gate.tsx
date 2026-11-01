import { router } from '@inertiajs/react';
import type { PendingVisit } from '@inertiajs/core';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function PasswordConfirmationGate() {
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [processing, setProcessing] = useState(false);
    const [pendingVisit, setPendingVisit] = useState<PendingVisit | null>(null);

    useEffect(() => {
        const removeBeforeListener = router.on('before', (event) => {
            const visit = event.detail.visit;

            if (visit.url.pathname !== '/user/confirm-password') {
                setPendingVisit(visit);
            }
        });

        const removeExceptionListener = router.on('httpException', (event) => {
            if (
                event.detail.response.headers['x-password-confirmation'] !==
                'required'
            ) {
                return;
            }

            setError('');
            setOpen(true);

            return false;
        });

        return () => {
            removeBeforeListener();
            removeExceptionListener();
        };
    }, []);

    const confirmPassword = () => {
        setProcessing(true);
        setError('');

        router.post(
            '/user/confirm-password',
            { password },
            {
                preserveScroll: true,
                preserveState: true,
                onSuccess: () => {
                    const visit = pendingVisit;
                    setProcessing(false);
                    setOpen(false);
                    setPassword('');
                    setPendingVisit(null);

                    if (visit) {
                        router.visit(visit.url, {
                            method: visit.method,
                            data: visit.data,
                            preserveScroll: visit.preserveScroll,
                            preserveState: visit.preserveState,
                        });
                    }
                },
                onError: (errors) => {
                    setProcessing(false);
                    setError(errors.password ?? 'Mật khẩu không đúng.');
                },
            },
        );
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Xác nhận mật khẩu</DialogTitle>
                    <DialogDescription>
                        Vui lòng nhập lại mật khẩu để tiếp tục thao tác này.
                    </DialogDescription>
                </DialogHeader>

                <form
                    className="space-y-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        confirmPassword();
                    }}
                >
                    <div className="space-y-2">
                        <Label htmlFor="password-confirmation-gate">
                            Mật khẩu
                        </Label>
                        <Input
                            id="password-confirmation-gate"
                            type="password"
                            autoComplete="current-password"
                            autoFocus
                            value={password}
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                        />
                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setOpen(false)}
                            disabled={processing}
                        >
                            Hủy
                        </Button>
                        <Button
                            type="submit"
                            disabled={processing || !password}
                        >
                            {processing ? 'Đang xác nhận...' : 'Xác nhận'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
