import { useEffect, useState } from 'react';
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

export type ExportScope =
    'current_page' | 'all_items' | 'current_filter' | 'selected';
export type ExportFormat = 'xlsx' | 'csv';
export type ExportLocale = 'all' | 'vi' | 'en';

export type ExportOptions = {
    scope: ExportScope;
    format: ExportFormat;
    locale: ExportLocale;
};

function OptionGroup<TValue extends string>({
    name,
    value,
    onChange,
    options,
}: {
    name: string;
    value: TValue;
    onChange: (value: TValue) => void;
    options: { value: TValue; label: string }[];
}) {
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
                        name={name}
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

/** * "Current page" / "current filter" export rows already resolved client-side; "all items" re-queries the backend. */
export function ExportDialog({
    open,
    onOpenChange,
    onConfirm,
    hasSelection,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (options: ExportOptions) => void;
    hasSelection?: boolean;
}) {
    const [scope, setScope] = useState<ExportScope>('current_page');
    const [format, setFormat] = useState<ExportFormat>('xlsx');
    const [locale, setLocale] = useState<ExportLocale>('all');

    useEffect(() => {
        if (open) {
            setScope(hasSelection ? 'selected' : 'current_page');
        }
    }, [open, hasSelection]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-base">
                        Xuất dữ liệu
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label className="text-xs">Lựa chọn dữ liệu</Label>
                        <OptionGroup
                            name="export-scope"
                            value={scope}
                            onChange={setScope}
                            options={[
                                ...(hasSelection
                                    ? [
                                          {
                                              value: 'selected' as const,
                                              label: 'Dữ liệu đã tích chọn',
                                          },
                                      ]
                                    : []),
                                {
                                    value: 'current_page',
                                    label: 'Trang hiện tại',
                                },
                                { value: 'all_items', label: 'Tất cả dữ liệu' },
                                {
                                    value: 'current_filter',
                                    label: 'Theo bộ lọc hiện tại',
                                },
                            ]}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs">
                            Chọn dạng file sẽ xuất
                        </Label>
                        <OptionGroup
                            name="export-format"
                            value={format}
                            onChange={setFormat}
                            options={[
                                {
                                    value: 'xlsx',
                                    label: 'Xuất file Excel (XLSX)',
                                },
                                { value: 'csv', label: 'Xuất file CSV' },
                            ]}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs">Ngôn ngữ</Label>
                        <OptionGroup
                            name="export-locale"
                            value={locale}
                            onChange={setLocale}
                            options={[
                                { value: 'all', label: 'Tất cả' },
                                { value: 'vi', label: 'Tiếng Việt' },
                                { value: 'en', label: 'English' },
                            ]}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Hủy
                    </Button>
                    <Button
                        type="button"
                        onClick={() => {
                            onConfirm({ scope, format, locale });
                            onOpenChange(false);
                        }}
                    >
                        Xuất
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
