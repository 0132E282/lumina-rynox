import {
    createContext,
    useCallback,
    useContext,
    useRef,
    useState,
} from 'react';
import type { ReactNode } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ConfirmOptions = {
    title?: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
};

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [options, setOptions] = useState<ConfirmOptions>({});
    const resolveRef = useRef<(value: boolean) => void>(null);

    const confirm = useCallback<ConfirmFn>((opts) => {
        setOptions(typeof opts === 'string' ? { description: opts } : opts);
        setOpen(true);

        return new Promise<boolean>((resolve) => {
            resolveRef.current = resolve;
        });
    }, []);

    const settle = (value: boolean) => {
        setOpen(false);
        resolveRef.current?.(value);
        resolveRef.current = null;
    };

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <AlertDialog
                open={open}
                onOpenChange={(next) => !next && settle(false)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {options.title ?? 'Bạn có chắc chắn?'}
                        </AlertDialogTitle>
                        {options.description && (
                            <AlertDialogDescription>
                                {options.description}
                            </AlertDialogDescription>
                        )}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => settle(false)}>
                            {options.cancelLabel ?? 'Hủy'}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => settle(true)}
                            className={
                                options.destructive
                                    ? 'bg-destructive text-white hover:bg-destructive/90'
                                    : undefined
                            }
                        >
                            {options.confirmLabel ?? 'Đồng ý'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ConfirmContext.Provider>
    );
}

export function useConfirm(): ConfirmFn {
    const confirm = useContext(ConfirmContext);

    if (!confirm) {
        throw new Error(
            'useConfirm must be used within a ConfirmDialogProvider',
        );
    }

    return confirm;
}
