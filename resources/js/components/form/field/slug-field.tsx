import { useEffect, useRef, useState } from 'react';
import type { Control } from 'react-hook-form';
import { useController, useWatch } from 'react-hook-form';
import {
    useFormCollection,
    useFormRecordId,
} from '@/components/form/collection-context';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

export interface SlugFieldProps {
    name: string;
    control?: Control;
    /** * Field to generate the slug from while the toggle is on; defaults to `name`. */
    source?: string;
    fieldProps?: Record<string, unknown>;
}

function slugify(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** * Recomputes the slug from `source` while the toggle is on; typing into the slug turns it off. */
export default function SlugField({
    name,
    control,
    source = 'name',
}: SlugFieldProps) {
    const { field } = useController({ name, control, defaultValue: '' });
    const sourceValue = useWatch({ control, name: source }) as
        string | undefined;
    const currentSlug = (field.value as string | undefined) ?? '';
    const [auto, setAuto] = useState(true);
    const isInitialized = useRef(false);

    const collection = useFormCollection();
    const recordId = useFormRecordId();
    const [slugError, setSlugError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        // * `source` is empty until the initial `reset()`; wait instead of treating it as a change.
        if (!sourceValue) {
            return;
        }

        // ! Decided once on first real data: a saved slug that differs from the derived one was edited by hand — don't overwrite it.
        if (!isInitialized.current) {
            isInitialized.current = true;
            setAuto(currentSlug === '' || currentSlug === slugify(sourceValue));

            return;
        }

        if (auto) {
            field.onChange(slugify(sourceValue));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the watched source value (or the toggle) changes
    }, [sourceValue, auto]);

    if (!control) {
        return null;
    }

    // * Re-checking regenerates immediately because the effect also depends on `auto`.
    const handleAutoChange = (checked: boolean) => setAuto(checked);

    // * `items.show` resolves id or slug: a 200 with another record's id means the slug is taken.
    const checkSlugTaken = async () => {
        field.onBlur();

        if (!collection || !currentSlug) {
            return;
        }

        setChecking(true);

        try {
            const response = await api.get<{ data: { id: string | number } }>(
                window.route('items.show', {
                    resource: collection,
                    idOrSlug: currentSlug,
                }),
            );

            setSlugError(
                String(response.data.data.id) === String(recordId ?? '')
                    ? null
                    : 'Slug đã tồn tại.',
            );
        } catch {
            setSlugError(null);
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="relative">
                <Input
                    id={name}
                    value={currentSlug}
                    onChange={(event) => {
                        setAuto(false);
                        field.onChange(event.target.value);
                    }}
                    onBlur={checkSlugTaken}
                    className="pr-9"
                />
                <Checkbox
                    checked={auto}
                    onCheckedChange={handleAutoChange}
                    title="Tự động tạo từ tên"
                    className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
                />
            </div>
            {slugError && (
                <p className="animate-in text-[0.8rem] font-medium text-destructive fade-in">
                    {slugError}
                </p>
            )}
            {checking && (
                <p className="text-[0.8rem] text-muted-foreground">
                    Đang kiểm tra slug…
                </p>
            )}
        </div>
    );
}
