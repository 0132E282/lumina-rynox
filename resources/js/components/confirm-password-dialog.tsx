import { router } from '@inertiajs/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
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

export interface ConfirmPasswordDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirmed: () => void;
}

export default function ConfirmPasswordDialog({
    open,
    onOpenChange,
    onConfirmed,
}: ConfirmPasswordDialogProps) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);

    const close = () => {
        onOpenChange(false);
        setPassword('');
        setError(null);
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setProcessing(true);

        router.post(
            '/user/confirm-password',
            { password },
            {
                preserveScroll: true,
                preserveState: true,
                onSuccess: () => {
                    setProcessing(false);
                    close();
                    onConfirmed();
                },
                onError: (errs) => {
                    setProcessing(false);
                    setError(errs.password ?? 'Mật khẩu không đúng.');
                },
            },
        );
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !next && close()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Xác nhận mật khẩu</DialogTitle>
                    <DialogDescription>
                        Vui lòng nhập lại mật khẩu để tiếp tục thao tác này.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <Input
                        type="password"
                        autoFocus
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Mật khẩu"
                    />
                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={close}>
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
