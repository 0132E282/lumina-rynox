import { Children, isValidElement, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Control } from 'react-hook-form';
import { useController } from 'react-hook-form';
import {
    useFormCollection,
    useFormRecordId,
} from '@/components/form/collection-context';
import { InputSelect } from '@/components/ui/input-select';
import type { InputSelectOption } from '@/components/ui/input-select';
import { useRemoteOptions } from '@/hooks/use-remote-options';

export interface SelectFieldProps {
    name: string;
    control?: Control;
    multiple?: boolean;
    placeholder?: string;
    options?: InputSelectOption[];
    /** * Backward compatibility: options from `<option>` children. */
    children?: ReactNode;
    fieldProps?: Record<string, unknown>;
    maxLength?: unknown;
    /** * Field whose options to fetch; defaults to `name`. */
    source?: string;
}

function optionsFromChildren(children: ReactNode): InputSelectOption[] {
    return Children.toArray(children)
        .filter(
            (
                child,
            ): child is ReactElement<{
                value?: string;
                children?: ReactNode;
            }> => isValidElement(child),
        )
        .map((child) => ({
            value: String(child.props.value ?? ''),
            label: String(child.props.children ?? ''),
        }));
}

/** * Stored values may be `{value, label}` pairs from `withRelations()` (labels for lazily-loaded lists) or bare ids. */
type SelectValue =
    | string
    | number
    | {
          id?: string | number;
          value?: string | number;
          label?: string;
          name?: string;
          title?: string;
      };

function idOf(entry: SelectValue): string {
    if (typeof entry === 'object' && entry !== null) {
        return String(entry.value ?? entry.id ?? '');
    }

    return String(entry);
}

function labelOptionOf(entry: SelectValue): InputSelectOption | null {
    if (typeof entry === 'object' && entry !== null) {
        const value = String(entry.value ?? entry.id ?? '');

        const label = String(entry.label ?? entry.name ?? entry.title ?? value);

        return { value, label };
    }

    return null;
}

/**
 * * Bound with `useController` (InputSelect isn't a native select).
 * * Options: `options` prop → `<option>` children → `/items/{collection}/options/{source ?? name}`.
 */
export default function SelectField({
    name,
    control,
    multiple,
    placeholder,
    options,
    children,
    fieldProps,
    maxLength,
    source,
}: SelectFieldProps) {
    void fieldProps;
    void maxLength;

    const collection = useFormCollection();
    const recordId = useFormRecordId();
    const staticOptions = useMemo(
        () => options ?? (children ? optionsFromChildren(children) : undefined),
        [options, children],
    );

    // * Exclude the current record client-side so switching records doesn't refetch the list.
    const remoteSource = useMemo(
        () =>
            staticOptions || !collection
                ? undefined
                : { collection, field: source ?? name },
        [staticOptions, collection, source, name],
    );
    const {
        options: remoteOptions,
        onSearchChange: setSearchInput,
        onLoadMore: loadMore,
        loading: loadingMore,
    } = useRemoteOptions(remoteSource);

    const baseOptions = useMemo(() => {
        const all = staticOptions ?? remoteOptions;

        return recordId === undefined
            ? all
            : all.filter((option) => option.value !== String(recordId));
    }, [staticOptions, remoteOptions, recordId]);

    const { field } = useController({
        name,
        control,
        defaultValue: multiple ? [] : null,
    });

    const searchProps = staticOptions
        ? {}
        : {
              onSearchChange: setSearchInput,
              onLoadMore: loadMore,
              loading: loadingMore,
          };

    if (multiple) {
        const rawValues = (field.value as SelectValue[] | null) ?? [];
        const knownLabels = rawValues
            .map(labelOptionOf)
            .filter((option): option is InputSelectOption => option !== null);
        const seen = new Set(baseOptions.map((option) => option.value));
        const resolvedOptions = [
            ...baseOptions,
            ...knownLabels.filter((option) => !seen.has(option.value)),
        ];

        return (
            <InputSelect
                multiple
                options={resolvedOptions}
                value={rawValues.map(idOf)}
                onChange={field.onChange}
                placeholder={placeholder}
                {...searchProps}
            />
        );
    }

    const rawValue = field.value as SelectValue | null;
    const knownLabel = rawValue !== null ? labelOptionOf(rawValue) : null;
    const resolvedOptions =
        knownLabel &&
        !baseOptions.some((option) => option.value === knownLabel.value)
            ? [...baseOptions, knownLabel]
            : baseOptions;

    return (
        <InputSelect
            options={resolvedOptions}
            value={rawValue !== null ? idOf(rawValue) : null}
            onChange={field.onChange}
            placeholder={placeholder}
            {...searchProps}
        />
    );
}
