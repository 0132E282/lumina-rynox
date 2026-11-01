import { ListFilter, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputSelect } from '@/components/ui/input-select';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useRemoteOptions } from '@/hooks/use-remote-options';

export type FilterOperator =
    | '_like'
    | '_nlike'
    | '_eq'
    | '_neq'
    | '_startswith'
    | '_endswith'
    | '_is_empty'
    | '_is_not_empty'
    | '_is_null'
    | '_is_not_null'
    | '_in'
    | '_nin';

export type FilterMatch = 'all' | 'any';

export type FilterCondition = {
    id: string;
    field: string;
    operator: FilterOperator;
    value: string | string[];
};

export type FilterField = {
    id: string;
    label: string;
    filterOptions?: { value: string; label: string }[];
    filterRelation?: { collection: string; field?: string };
    filterInputType?: 'date' | 'datetime-local';
    filterMultiple?: boolean;
};

const OPERATOR_LABEL: Record<FilterOperator, string> = {
    _like: 'chứa',
    _nlike: 'không chứa',
    _eq: 'là',
    _neq: 'không là',
    _startswith: 'bắt đầu bằng',
    _endswith: 'kết thúc bằng',
    _is_empty: 'trống',
    _is_not_empty: 'không trống',
    _is_null: 'chưa thiết lập',
    _is_not_null: 'đã thiết lập',
    _in: 'là một trong',
    _nin: 'không là một trong',
};

const OPERATORS = Object.keys(OPERATOR_LABEL) as FilterOperator[];

// * `_in`/`_nin` only make sense for array values; the rest assume a single scalar.
const MULTIPLE_FIELD_OPERATORS: FilterOperator[] = [
    '_in',
    '_nin',
    '_is_null',
    '_is_not_null',
];

const SINGLE_FIELD_OPERATORS = OPERATORS.filter(
    (operator) => !['_in', '_nin'].includes(operator),
);

export const VALUELESS_OPERATORS: FilterOperator[] = [
    '_is_empty',
    '_is_not_empty',
    '_is_null',
    '_is_not_null',
];

function getFieldValue(row: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => {
        if (value === null || value === undefined) {
            return undefined;
        }

        return (value as Record<string, unknown>)[key];
    }, row);
}

function matchesCondition(
    row: Record<string, unknown>,
    condition: FilterCondition,
): boolean {
    const raw = getFieldValue(row, condition.field);
    const value =
        raw === null || raw === undefined ? '' : String(raw).toLowerCase();

    if (condition.operator === '_in' || condition.operator === '_nin') {
        const targets = (
            Array.isArray(condition.value) ? condition.value : [condition.value]
        ).map((item) => item.toLowerCase());
        const isMember = targets.includes(value);

        return condition.operator === '_in' ? isMember : !isMember;
    }

    const target = (
        Array.isArray(condition.value)
            ? (condition.value[0] ?? '')
            : condition.value
    ).toLowerCase();

    switch (condition.operator) {
        case '_like':
            return value.includes(target);
        case '_nlike':
            return !value.includes(target);
        case '_eq':
            return value === target;
        case '_neq':
            return value !== target;
        case '_startswith':
            return value.startsWith(target);
        case '_endswith':
            return value.endsWith(target);
        case '_is_empty':
            return value === '';
        case '_is_not_empty':
            return value !== '';
        case '_is_null':
            return raw === null || raw === undefined;
        case '_is_not_null':
            return raw !== null && raw !== undefined;
        default:
            return true;
    }
}

export function applyAdvancedFilter<TData>(
    data: TData[],
    conditions: FilterCondition[],
    match: FilterMatch,
): TData[] {
    const active = conditions.filter((condition) => condition.field);

    if (active.length === 0) {
        return data;
    }

    return data.filter((row) => {
        const results = active.map((condition) =>
            matchesCondition(row as Record<string, unknown>, condition),
        );

        return match === 'all' ? results.every(Boolean) : results.some(Boolean);
    });
}

function emptyCondition(): FilterCondition {
    return { id: crypto.randomUUID(), field: '', operator: '_like', value: '' };
}

function FilterValueInput({
    field,
    condition,
    disabled,
    onChange,
}: {
    field: FilterField | undefined;
    condition: FilterCondition;
    disabled: boolean;
    onChange: (value: string | string[]) => void;
}) {
    const relationSource = useMemo(
        () =>
            field?.filterRelation
                ? {
                      collection: field.filterRelation.collection,
                      field: field.filterRelation.field ?? field.id,
                  }
                : undefined,
        [field],
    );
    const relationOptions = useRemoteOptions(relationSource);
    const scalarValue =
        typeof condition.value === 'string' ? condition.value : '';
    const arrayValue = Array.isArray(condition.value) ? condition.value : [];

    if (field?.filterOptions) {
        if (field.filterMultiple) {
            return (
                <InputSelect
                    multiple
                    options={field.filterOptions}
                    value={arrayValue}
                    onChange={onChange}
                    placeholder="Chọn giá trị"
                    className="h-8 flex-1"
                    disabled={disabled}
                />
            );
        }

        return (
            <InputSelect
                options={field.filterOptions}
                value={scalarValue || null}
                onChange={(value) => onChange(value ?? '')}
                placeholder="Chọn giá trị"
                className="h-8 flex-1"
                disabled={disabled}
            />
        );
    }

    if (field?.filterRelation) {
        if (field.filterMultiple) {
            return (
                <InputSelect
                    multiple
                    options={relationOptions.options}
                    value={arrayValue}
                    onChange={onChange}
                    placeholder="Chọn giá trị"
                    className="h-8 flex-1"
                    disabled={disabled}
                    onSearchChange={relationOptions.onSearchChange}
                    onLoadMore={relationOptions.onLoadMore}
                    loading={relationOptions.loading}
                />
            );
        }

        return (
            <InputSelect
                options={relationOptions.options}
                value={scalarValue || null}
                onChange={(value) => onChange(value ?? '')}
                placeholder="Chọn giá trị"
                className="h-8 flex-1"
                disabled={disabled}
                onSearchChange={relationOptions.onSearchChange}
                onLoadMore={relationOptions.onLoadMore}
                loading={relationOptions.loading}
            />
        );
    }

    if (field?.filterInputType) {
        return (
            <Input
                type={field.filterInputType}
                value={scalarValue}
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
                className="h-8 flex-1"
            />
        );
    }

    return (
        <Input
            value={scalarValue}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Nhập tại đây"
            disabled={disabled}
            className="h-8 flex-1"
        />
    );
}

export function DataTableFilterPopover({
    fields,
    match,
    conditions,
    onApply,
}: {
    fields: FilterField[];
    match: FilterMatch;
    conditions: FilterCondition[];
    onApply: (conditions: FilterCondition[], match: FilterMatch) => void;
}) {
    const [open, setOpen] = useState(false);
    const [draftMatch, setDraftMatch] = useState<FilterMatch>(match);
    const [draftConditions, setDraftConditions] = useState<FilterCondition[]>(
        conditions.length ? conditions : [emptyCondition()],
    );

    useEffect(() => {
        if (open) {
            setDraftMatch(match);
            setDraftConditions(
                conditions.length ? conditions : [emptyCondition()],
            );
        }
    }, [open, match, conditions]);

    const activeCount = conditions.filter(
        (condition) => condition.field,
    ).length;

    const updateCondition = (id: string, patch: Partial<FilterCondition>) => {
        setDraftConditions((current) =>
            current.map((condition) =>
                condition.id === id ? { ...condition, ...patch } : condition,
            ),
        );
    };

    const removeCondition = (id: string) => {
        setDraftConditions((current) =>
            current.filter((condition) => condition.id !== id),
        );
    };

    // * Switching field between a multi-select and a scalar one can leave the operator/value from the other shape behind.
    const changeConditionField = (id: string, fieldId: string) => {
        const nextField = fields.find((field) => field.id === fieldId);
        const multiple = nextField?.filterMultiple === true;
        const allowedOperators = multiple
            ? MULTIPLE_FIELD_OPERATORS
            : SINGLE_FIELD_OPERATORS;

        setDraftConditions((current) =>
            current.map((condition) => {
                if (condition.id !== id) {
                    return condition;
                }

                const valueMatchesShape = multiple
                    ? Array.isArray(condition.value)
                    : typeof condition.value === 'string';
                const operatorStillValid = allowedOperators.includes(
                    condition.operator,
                );

                return {
                    ...condition,
                    field: fieldId,
                    operator: operatorStillValid
                        ? condition.operator
                        : allowedOperators[0],
                    value:
                        valueMatchesShape && operatorStillValid
                            ? condition.value
                            : multiple
                              ? []
                              : '',
                };
            }),
        );
    };

    const apply = () => {
        onApply(
            draftConditions.filter((condition) => condition.field),
            draftMatch,
        );
        setOpen(false);
    };

    const reset = () => {
        setDraftConditions([emptyCondition()]);
        setDraftMatch('all');
        onApply([], 'all');
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                    <ListFilter className="size-4" />
                    Bộ lọc
                    {activeCount > 0 && (
                        <span className="ml-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                            {activeCount}
                        </span>
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[900px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ListFilter className="size-4" />
                        Bộ lọc
                    </DialogTitle>
                </DialogHeader>

                <div className="flex items-center gap-2 text-sm">
                    <span>Khớp với</span>
                    <Select
                        value={draftMatch}
                        onValueChange={(value) =>
                            setDraftMatch(value as FilterMatch)
                        }
                    >
                        <SelectTrigger size="sm" className="h-7 w-24">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Tất cả</SelectItem>
                            <SelectItem value="any">Bất kỳ</SelectItem>
                        </SelectContent>
                    </Select>
                    <span>điều kiện</span>
                </div>

                <div className="flex flex-col gap-2">
                    {draftConditions.map((condition) => {
                        const disabled = !condition.field;
                        const valueless = VALUELESS_OPERATORS.includes(
                            condition.operator,
                        );
                        const activeField = fields.find(
                            (field) => field.id === condition.field,
                        );
                        const operatorOptions = activeField?.filterMultiple
                            ? MULTIPLE_FIELD_OPERATORS
                            : SINGLE_FIELD_OPERATORS;

                        return (
                            <div
                                key={condition.id}
                                className="flex items-center gap-2"
                            >
                                <Select
                                    value={condition.field}
                                    onValueChange={(value) =>
                                        changeConditionField(
                                            condition.id,
                                            value,
                                        )
                                    }
                                >
                                    <SelectTrigger
                                        size="sm"
                                        className="h-8 min-w-36 flex-1"
                                    >
                                        <SelectValue placeholder="Chọn trường" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {fields.map((field) => (
                                            <SelectItem
                                                key={field.id}
                                                value={field.id}
                                            >
                                                {field.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select
                                    value={condition.operator}
                                    onValueChange={(value) =>
                                        updateCondition(condition.id, {
                                            operator: value as FilterOperator,
                                        })
                                    }
                                    disabled={disabled}
                                >
                                    <SelectTrigger
                                        size="sm"
                                        className="h-8 w-36"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {operatorOptions.map((operator) => (
                                            <SelectItem
                                                key={operator}
                                                value={operator}
                                            >
                                                {OPERATOR_LABEL[operator]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <FilterValueInput
                                    field={activeField}
                                    condition={condition}
                                    disabled={disabled || valueless}
                                    onChange={(value) =>
                                        updateCondition(condition.id, { value })
                                    }
                                />

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 shrink-0"
                                    title="Xóa điều kiện"
                                    onClick={() =>
                                        removeCondition(condition.id)
                                    }
                                >
                                    <X className="size-3.5" />
                                </Button>
                            </div>
                        );
                    })}
                </div>

                <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-8 justify-start px-1 text-muted-foreground"
                    onClick={() =>
                        setDraftConditions((current) => [
                            ...current,
                            emptyCondition(),
                        ])
                    }
                >
                    <Plus className="size-3.5" />
                    Thêm điều kiện
                </Button>

                <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3">
                    <Button variant="outline" size="sm" onClick={reset}>
                        Đặt lại
                    </Button>
                    <Button size="sm" onClick={apply}>
                        Áp dụng
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
