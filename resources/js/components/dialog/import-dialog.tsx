import { Upload } from 'lucide-react';
import type { DragEvent } from 'react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type ImportLocale = 'all' | 'vi' | 'en';
export type ImportOptions = { locale: ImportLocale };

const ACCEPTED_EXTENSIONS = ['.xls', '.xlsx', '.csv'];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

function LocaleOptionGroup({
    value,
    onChange,
}: {
    value: ImportLocale;
    onChange: (value: ImportLocale) => void;
}) {
    const options: { value: ImportLocale; label: string }[] = [
        { value: 'all', label: 'Đa ngữ (tất cả)' },
        { value: 'vi', label: 'Tiếng Việt' },
        { value: 'en', label: 'English' },
    ];

    return (
        <div className="flex flex-wrap gap-2">
            {options.map((option) => (
                <label
                    key={option.value}
                    className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                        value === option.value
                            ? 'border-primary bg-primary/5 font-medium'
                            : 'border-input hover:bg-accent',
                    )}
                >
                    <input
                        type="radio"
                        name="import-locale"
                        className="accent-primary"
                        checked={value === option.value}
                        onChange={() => onChange(option.value)}
                    />
                    {option.label}
                </label>
            ))}
        </div>
    );
}

export function ImportDialog({
    open,
    onOpenChange,
    onConfirm,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (file: File, options: ImportOptions) => void;
}) {
    const [file, setFile] = useState<File | null>(null);
    const [locale, setLocale] = useState<ImportLocale>('all');
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const reset = () => {
        setFile(null);
        setLocale('all');
        setIsDragging(false);
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            reset();
        }

        onOpenChange(nextOpen);
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);

        const dropped = event.dataTransfer.files?.[0];

        if (dropped) {
            setFile(dropped);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-base">
                        Nhập dữ liệu
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div
                        onDragOver={(event) => {
                            event.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        className={cn(
                            'flex h-[120px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 transition-colors',
                            isDragging
                                ? 'border-primary bg-primary/5'
                                : 'border-input',
                        )}
                    >
                        <input
                            ref={inputRef}
                            type="file"
                            accept={ACCEPT_ATTR}
                            className="hidden"
                            onChange={(event) => {
                                const selected = event.target.files?.[0];

                                if (selected) {
                                    setFile(selected);
                                }

                                event.target.value = '';
                            }}
                        />

                        {file ? (
                            <>
                                <span className="max-w-[80%] truncate text-sm font-medium">
                                    {file.name}
                                </span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => inputRef.current?.click()}
                                >
                                    Chọn file khác
                                </Button>
                            </>
                        ) : (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => inputRef.current?.click()}
                            >
                                <Upload className="size-4" />
                                Chọn file
                            </Button>
                        )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                        Hỗ trợ file Excel (XLSX, XLS) và CSV. Tối đa 20MB và
                        50.000 dòng.
                    </p>

                    <div className="space-y-2">
                        <Label className="text-xs">Ngôn ngữ</Label>
                        <LocaleOptionGroup
                            value={locale}
                            onChange={setLocale}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleOpenChange(false)}
                    >
                        Hủy
                    </Button>
                    <Button
                        type="button"
                        disabled={!file}
                        onClick={() => {
                            if (!file) {
                                return;
                            }

                            onConfirm(file, { locale });
                            handleOpenChange(false);
                        }}
                    >
                        Nhập dữ liệu
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
