import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Control } from 'react-hook-form';
import { useFieldArray } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { InputSelect } from '@/components/ui/input-select';
import type { InputSelectOption } from '@/components/ui/input-select';
import { api } from '@/lib/api';

export interface AttributePairsFieldProps {
    name: string;
    control?: Control;
}

type AttributePair = { option_id: string | null; value_id: string | null };

/** * Either the field's own `{option_id, value_id}` or, for untouched server rows, what `withRelations()` sent. */
type RawPairEntry = Partial<AttributePair> & {
    id?: string | number;
    value?: string | number;
    label?: string;
    parent_id?: string | number | null;
    pivot?: {
        option_id?: string | number;
        [key: string]: unknown;
    };
};

function normalizePair(raw: RawPairEntry): AttributePair {
    const rawValueId =
        raw.value_id ??
        raw.value ??
        raw.pivot?.option_id ??
        (typeof raw.id === 'number' ||
        (typeof raw.id === 'string' && /^\d+$/.test(raw.id))
            ? raw.id
            : null);

    return {
        option_id: raw.option_id
            ? String(raw.option_id)
            : raw.parent_id != null
              ? String(raw.parent_id)
              : null,
        value_id: rawValueId != null ? String(rawValueId) : null,
    };
}

/** * Sentinel meaning "field is null" (root options have no `parent_id`). */
const IS_NULL = '__is_null__';

/** * `{value_id => parent_id}`: loaded pairs carry only the value id, so the attribute is looked up here. */
function useOptionParentMap(): Record<string, string | null> {
    const [map, setMap] = useState<Record<string, string | null>>({});

    useEffect(() => {
        let cancelled = false;

        api.get<{ data: Record<string, unknown>[] }>(
            window.route('items.index', { resource: 'options' }),
            { params: { limit: -1 } },
        ).then((response) => {
            if (!cancelled) {
                setMap(
                    Object.fromEntries(
                        response.data.data.map((row) => [
                            String(row.id),
                            row.parent_id != null
                                ? String(row.parent_id)
                                : null,
                        ]),
                    ),
                );
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    return map;
}

function useRemoteOptions(
    resource: string,
    labelKey: string,
    filter?: Record<string, string>,
) {
    const [options, setOptions] = useState<InputSelectOption[]>([]);
    const filterKey = filter ? JSON.stringify(filter) : '';
    const filterReady =
        !filter ||
        Object.values(filter).every((value) => value === IS_NULL || !!value);

    useEffect(() => {
        if (!filterReady) {
            return;
        }

        let cancelled = false;
        const params: Record<string, string | number> = {
            limit: -1,
            ...Object.fromEntries(
                Object.entries(filter ?? {}).map(([key, val]) => [
                    val === IS_NULL
                        ? `filters[${key}][_is_null]`
                        : `filters[${key}][_eq]`,
                    val === IS_NULL ? 1 : val,
                ]),
            ),
        };

        api.get<{ data: Record<string, unknown>[] }>(
            window.route('items.index', { resource }),
            { params },
        ).then((response) => {
            if (!cancelled) {
                setOptions(
                    response.data.data.map((row) => ({
                        value: String(row.id),
                        label: String(row[labelKey] ?? row.id),
                    })),
                );
            }
        });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `filter` is compared via `filterKey`
    }, [resource, labelKey, filterKey, filterReady]);

    return filterReady ? options : [];
}

function AttributePairRow({
    pair,
    optionChoices,
    onChangeOption,
    onChangeValue,
    onRemove,
}: {
    pair: AttributePair;
    optionChoices: InputSelectOption[];
    onChangeOption: (optionId: string | null) => void;
    onChangeValue: (valueId: string | null) => void;
    onRemove: () => void;
}) {
    const valueChoices = useRemoteOptions('options', 'name', {
        parent_id: pair.option_id ?? '',
    });

    return (
        <div className="flex items-center gap-2 rounded-md border p-2">
            <InputSelect
                className="flex-1"
                options={optionChoices}
                value={pair.option_id}
                onChange={onChangeOption}
                placeholder="Thuộc tính"
            />
            <InputSelect
                className="flex-1"
                options={valueChoices}
                value={pair.value_id}
                onChange={onChangeValue}
                placeholder="Giá trị"
            />
            <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onRemove}
            >
                Xoá
            </Button>
        </div>
    );
}

/** * Rows of (attribute, value), e.g. Màu sắc → Đỏ; value choices depend on the row's attribute. */
export default function AttributePairsField({
    name,
    control,
}: AttributePairsFieldProps) {
    const optionChoices = useRemoteOptions('options', 'name', {
        parent_id: IS_NULL,
    });
    const parentById = useOptionParentMap();
    const { fields, append, remove, update } = useFieldArray({ control, name });

    if (!control) {
        return null;
    }

    return (
        <div className="flex flex-col gap-2">
            {fields.map((field, index) => {
                const stored = normalizePair(field as unknown as RawPairEntry);
                // * Untouched server rows only carry the value id, so resolve `option_id` via `parentById`.
                const resolvedOptionId =
                    stored.option_id ??
                    (stored.value_id
                        ? (parentById[stored.value_id] ?? null)
                        : null);
                const pair: AttributePair = {
                    option_id: resolvedOptionId,
                    value_id: stored.value_id,
                };

                return (
                    <AttributePairRow
                        key={field.id}
                        pair={pair}
                        optionChoices={optionChoices}
                        onChangeOption={(optionId) =>
                            update(index, {
                                option_id: optionId,
                                value_id: null,
                            })
                        }
                        onChangeValue={(valueId) =>
                            update(index, {
                                option_id: resolvedOptionId,
                                value_id: valueId,
                            })
                        }
                        onRemove={() => remove(index)}
                    />
                );
            })}

            <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => append({ option_id: null, value_id: null })}
            >
                <Plus className="size-4" />
                Thêm thuộc tính
            </Button>
        </div>
    );
}
