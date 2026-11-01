import {
    createContext,
    useCallback,
    useContext,
    useRef,
    useState,
} from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type PromptOptions = {
    title?: string;
    label?: string;
    defaultValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
};

type PromptFn = (options: PromptOptions | string) => Promise<string | null>;

const PromptContext = createContext<PromptFn | null>(null);

export function PromptDialogProvider({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [options, setOptions] = useState<PromptOptions>({});
    const [value, setValue] = useState('');
    const resolveRef = useRef<(value: string | null) => void>(null);

    const prompt = useCallback<PromptFn>((opts) => {
        const resolved = typeof opts === 'string' ? { title: opts } : opts;

        setOptions(resolved);
        setValue(resolved.defaultValue ?? '');
        setOpen(true);

        return new Promise<string | null>((resolve) => {
            resolveRef.current = resolve;
        });
    }, []);

    const settle = (result: string | null) => {
        setOpen(false);
        resolveRef.current?.(result);
        resolveRef.current = null;
    };

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        settle(value.trim());
    };

    return (
        <PromptContext.Provider value={prompt}>
            {children}
            <Dialog open={open} onOpenChange={(next) => !next && settle(null)}>
                <DialogContent>
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>
                                {options.title ?? 'Nhập thông tin'}
                            </DialogTitle>
                        </DialogHeader>
                        <div className="grid gap-2 py-4">
                            {options.label && (
                                <Label htmlFor="prompt-dialog-input">
                                    {options.label}
                                </Label>
                            )}
                            <Input
                                id="prompt-dialog-input"
                                autoFocus
                                value={value}
                                placeholder={options.placeholder}
                                onChange={(
                                    e: React.ChangeEvent<HTMLInputElement>,
                                ) => setValue(e.target.value)}
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => settle(null)}
                            >
                                {options.cancelLabel ?? 'Hủy'}
                            </Button>
                            <Button type="submit" disabled={!value.trim()}>
                                {options.confirmLabel ?? 'Xác nhận'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </PromptContext.Provider>
    );
}

export function usePrompt(): PromptFn {
    const prompt = useContext(PromptContext);

    if (!prompt) {
        throw new Error('usePrompt must be used within a PromptDialogProvider');
    }

    return prompt;
}
