import { Link } from '@inertiajs/react';
import type { ColumnDef } from '@tanstack/react-table';
import { Copy, ImageOff, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { getFileUrl } from '@/components/file-viewer';
import type { FileViewerValue } from '@/components/file-viewer';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { RowActionsMenu } from '@/components/tables/row-actions-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { currentCollection, resourceRoute } from '@/lib/resource-route';
import { cn, formatDateTime } from '@/lib/utils';
import '@/types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
const DATE_FIELD_NAME_RE = /(_at|_date)$/i;

function formatCellValue(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '-';
    }

    if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
        return formatDateTime(value);
    }

    if (typeof value === 'boolean') {
        return value ? 'Có' : 'Không';
    }

    if (typeof value === 'number') {
        return value.toLocaleString('vi-VN');
    }

    return String(value);
}

/** * Auto-formats ISO dates, booleans and numbers. */
export function createColumn<TData extends { id: string | number }>({
    accessorKey,
    label,
    sortable = true,
    cell,
    link,
    relation,
    filterInputType,
}: {
    accessorKey: keyof TData & string;
    label: string;
    sortable?: boolean;
    cell?: ColumnDef<TData>['cell'];
    /** * `true` links to the row's edit page; a string is a `:field` path template; a function for custom links. */
    link?: boolean | string | ((row: TData) => string);
    /** * Filter dialog loads options from `/items/{collection}/options/{field}`; `multiple` renders a multi-select using `_in`/`_nin`. */
    relation?: { collection: string; field?: string; multiple?: boolean };
    filterInputType?: 'date' | 'datetime-local';
}): ColumnDef<TData> {
    const resolveHref =
        link === true
            ? (row: TData) =>
                  resourceRoute(
                      currentCollection(window.location.pathname),
                      row.id,
                  )
            : typeof link === 'string'
              ? (row: TData) =>
                    link.replace(/:(\w+)/g, (_, key) =>
                        String((row as Record<string, unknown>)[key] ?? ''),
                    )
              : link || undefined;

    // * Date fields are inferred from names like `created_at`, matching how cells auto-format ISO strings.
    const resolvedFilterInputType =
        filterInputType ??
        (DATE_FIELD_NAME_RE.test(accessorKey) ? 'date' : undefined);

    return {
        accessorKey,
        meta: {
            label,
            filterRelation: relation,
            filterInputType: resolvedFilterInputType,
            filterMultiple: relation?.multiple,
        },
        header: sortable
            ? ({ column }) => (
                  <DataTableColumnHeader column={column} title={label} />
              )
            : () => label,
        enableSorting: sortable,
        cell:
            cell ??
            (({ row }) => {
                const rawValue = accessorKey
                    .split('.')
                    .reduce((obj: any, key) => obj?.[key], row.original);
                const value = formatCellValue(rawValue);

                return resolveHref ? (
                    <Link
                        href={resolveHref(row.original)}
                        className="font-medium text-blue-600 dark:text-blue-400"
                    >
                        {value}
                    </Link>
                ) : (
                    value
                );
            }),
    };
}

/** * Formats with the row's `currencyKey` value (VND fallback). */
export function createPriceColumn<TData>({
    accessorKey,
    currencyKey,
    label,
    sortable = true,
}: {
    accessorKey: keyof TData & string;
    currencyKey: keyof TData & string;
    label: string;
    sortable?: boolean;
}): ColumnDef<TData> {
    return {
        accessorKey,
        meta: { label },
        header: sortable
            ? ({ column }) => (
                  <DataTableColumnHeader column={column} title={label} />
              )
            : () => label,
        enableSorting: sortable,
        cell: ({ row }) => {
            const amount = accessorKey
                .split('.')
                .reduce((obj: any, key) => obj?.[key], row.original) as number;
            const currency =
                (currencyKey
                    .split('.')
                    .reduce(
                        (obj: any, key) => obj?.[key],
                        row.original,
                    ) as string) || 'VND';

            return new Intl.NumberFormat('vi-VN', {
                style: 'currency',
                currency,
            }).format(amount || 0);
        },
    };
}

/** * Checkbox column; the cell shows `label(row)` (default: the row number) until hovered or ticked. */
export function createSelectColumn<TData>(
    label: (row: TData, index: number) => ReactNode = (_row, index) =>
        index + 1,
): ColumnDef<TData> {
    return {
        id: 'select',
        enableHiding: false,
        enableSorting: false,
        size: 40,
        // * Same centered box as the row cells below, so the header checkbox lines up with them.
        header: ({ table }) => (
            <div className="flex min-h-4 min-w-4 items-center justify-center">
                <Checkbox
                    checked={
                        table.getIsAllPageRowsSelected() ||
                        (table.getIsSomePageRowsSelected() && 'indeterminate')
                    }
                    onCheckedChange={(value) =>
                        table.toggleAllPageRowsSelected(!!value)
                    }
                    aria-label="Chọn tất cả"
                />
            </div>
        ),
        cell: ({ row }) => {
            const selected = row.getIsSelected();

            return (
                <div className="group/select flex min-h-4 min-w-4 items-center justify-center">
                    {selected ? (
                        <Checkbox
                            checked
                            onCheckedChange={(value) =>
                                row.toggleSelected(!!value)
                            }
                            aria-label="Chọn dòng"
                        />
                    ) : (
                        <>
                            <span className="text-sm text-muted-foreground tabular-nums group-hover/select:hidden">
                                {label(row.original, row.index)}
                            </span>
                            <Checkbox
                                className="hidden group-hover/select:flex"
                                onCheckedChange={(value) =>
                                    row.toggleSelected(!!value)
                                }
                                aria-label="Chọn dòng"
                            />
                        </>
                    )}
                </div>
            );
        },
    };
}

/** * Omit `href` to link the row to its own `/{collection}/{id}` page. */
export function createLinkColumn<TData extends { id: string | number }>({
    accessorKey,
    label,
    href = (row) =>
        resourceRoute(currentCollection(window.location.pathname), row.id),
}: {
    accessorKey: keyof TData & string;
    label: string;
    href?: (row: TData) => string;
}): ColumnDef<TData> {
    return {
        accessorKey,
        meta: { label },
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title={label} />
        ),
        cell: ({ row }) => (
            <Link
                href={href(row.original)}
                className="font-medium text-blue-600 dark:text-blue-400"
            >
                {String(row.getValue(accessorKey))}
            </Link>
        ),
    };
}

/** * Accepts any `FileViewerValue` shape; shows a placeholder when empty. */
export function createImageColumn<TData>({
    accessorKey,
    label,
    size = 50,
}: {
    accessorKey: keyof TData & string;
    label: string;
    /** * Pixels, default 50. */
    size?: number;
}): ColumnDef<TData> {
    return {
        accessorKey,
        meta: { label },
        header: () => label,
        enableSorting: false,
        // * TanStack defaults columns to 150px; pin to the thumbnail size.
        size,
        minSize: size,
        maxSize: size,
        cell: ({ row }) => {
            const value = accessorKey
                .split('.')
                .reduce(
                    (obj: any, key) => obj?.[key],
                    row.original,
                ) as FileViewerValue;
            const url = getFileUrl(value);

            return (
                <div
                    className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted"
                    style={{ width: size, height: size }}
                >
                    {url ? (
                        <img
                            src={url}
                            alt=""
                            className="size-full object-cover"
                        />
                    ) : (
                        <ImageOff className="size-1/2 text-muted-foreground" />
                    )}
                </div>
            );
        },
    };
}

type BadgeVariant = 'default' | 'destructive' | 'outline';

export type BadgeColor = { text: string; background: string };

/** * Omit `labelMap`/`variant` to load them from the model's `{FIELD}_LIST` via `/items/{collection}/options/{field}`. */
export function createBadgeColumn<TData, TValue extends string>({
    accessorKey,
    label,
    labelMap,
    variant,
    colors,
    filterable = true,
}: {
    accessorKey: keyof TData & string;
    label: string;
    labelMap?: Record<TValue, string>;
    variant?: Record<TValue, BadgeVariant> | ((value: TValue) => BadgeVariant);
    colors?: Partial<Record<TValue, BadgeColor>>;
    /** * Default true; false removes the header's "Lọc theo ..." dropdown. */
    filterable?: boolean;
}): ColumnDef<TData> {
    const resolveVariant =
        typeof variant === 'function'
            ? variant
            : (value: TValue) => variant?.[value];

    return {
        accessorKey,
        meta: {
            label,
            filterOptions: labelMap
                ? Object.entries(labelMap).map(([value, text]) => ({
                      value,
                      label: text as string,
                  }))
                : undefined,
        },
        filterFn: filterable && labelMap ? 'arrIncludesSome' : undefined,
        header: ({ column }) => (
            <DataTableColumnHeader
                column={column}
                title={label}
                filterOptions={
                    filterable && labelMap
                        ? Object.entries(labelMap).map(([value, text]) => ({
                              value,
                              label: text as string,
                          }))
                        : undefined
                }
            />
        ),
        cell: ({ row }) => {
            const value = accessorKey
                .split('.')
                .reduce((obj: any, key) => obj?.[key], row.original) as TValue;
            const color = colors?.[value];
            const badgeVariant = resolveVariant(value);
            const text = labelMap?.[value] ?? String(value);

            if (color) {
                return (
                    <Badge
                        style={{
                            color: color.text,
                            backgroundColor: color.background,
                            borderColor: 'transparent',
                        }}
                    >
                        {text}
                    </Badge>
                );
            }

            return (
                <Badge
                    variant={
                        badgeVariant === 'default' ? undefined : badgeVariant
                    }
                >
                    {text}
                </Badge>
            );
        },
    };
}

export type ColumnConfig<TData extends { id: string | number }> =
    | ({ type?: 'text' } & Parameters<typeof createColumn<TData>>[0])
    | ({ type: 'link' } & Parameters<typeof createLinkColumn<TData>>[0])
    | ({ type: 'badge' } & Parameters<
          typeof createBadgeColumn<TData, string>
      >[0])
    | ({ type: 'price' } & Parameters<typeof createPriceColumn<TData>>[0])
    | ({ type: 'image' } & Parameters<typeof createImageColumn<TData>>[0])
    | {
          type: 'custom';
          column: ColumnDef<TData>;
          /** * Set so the fetch still requests fields a custom cell reads. */
          accessorKey?: keyof TData & string;
      };

/** * Builds columns from configs by `type` (default 'text'); `{ type: 'custom', column }` for a hand-written ColumnDef. */
export function createColumns<TData extends { id: string | number }>(
    configs: ColumnConfig<TData>[],
): ColumnDef<TData>[] {
    return configs.map((config) => {
        switch (config.type) {
            case 'link':
                return createLinkColumn<TData>(config);
            case 'badge':
                return createBadgeColumn<TData, string>(config);
            case 'price':
                return createPriceColumn<TData>(config);
            case 'image':
                return createImageColumn<TData>(config);
            case 'custom':
                return config.accessorKey
                    ? { ...config.column, accessorKey: config.accessorKey }
                    : config.column;
            case 'text':
            case undefined:
                return createColumn<TData>(config);
        }
    });
}

/** * Memoized on mount: pass a literal array, not one built from state. */
export function useColumns<TData extends { id: string | number }>(
    configs: ColumnConfig<TData>[],
): ColumnDef<TData>[] {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => createColumns<TData>(configs), []);
}

export type LocaleStatus = { code: string; filled: boolean };

function LocaleBadges({ locales }: { locales: LocaleStatus[] }) {
    return (
        <div className="flex items-center gap-1">
            {locales.map(({ code, filled }) => (
                <span
                    key={code}
                    className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                        filled
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                            : 'bg-muted text-muted-foreground',
                    )}
                >
                    {code}
                </span>
            ))}
        </div>
    );
}

export function createActionsColumn<TData>({
    onDelete,
    onDuplicate,
    onRestore,
    onForceDelete,
    locales,
}: {
    onDelete?: (row: TData) => void;
    onDuplicate?: (row: TData) => void;
    /** * Trash view: swaps Duplicate/Delete for Restore/Delete permanently. */
    onRestore?: (row: TData) => void;
    onForceDelete?: (row: TData) => void;
    /** * Per-row locale badges (green = has content). */
    locales?: (row: TData) => LocaleStatus[] | undefined;
}): ColumnDef<TData> {
    return {
        id: 'actions',
        meta: { label: 'Hành động' },
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => {
            const rowLocales = locales?.(row.original);

            const actions = [
                onRestore && {
                    key: 'restore',
                    label: 'Khôi phục',
                    icon: RotateCcw,
                    onClick: () => onRestore(row.original),
                },
                onForceDelete && {
                    key: 'force-delete',
                    label: 'Xóa vĩnh viễn',
                    icon: Trash2,
                    destructive: true,
                    onClick: () => onForceDelete(row.original),
                },
                onDuplicate && {
                    key: 'duplicate',
                    label: 'Nhân bản',
                    icon: Copy,
                    onClick: () => onDuplicate(row.original),
                },
                onDelete && {
                    key: 'delete',
                    label: 'Xóa',
                    icon: Trash2,
                    destructive: true,
                    onClick: () => onDelete(row.original),
                },
            ].filter((action): action is NonNullable<typeof action> =>
                Boolean(action),
            );

            if (actions.length === 0) {
                return rowLocales?.length ? (
                    <div className="flex justify-end">
                        <LocaleBadges locales={rowLocales} />
                    </div>
                ) : null;
            }

            if (actions.length <= 2) {
                return (
                    <div className="flex items-center justify-end gap-1">
                        {rowLocales?.length ? (
                            <LocaleBadges locales={rowLocales} />
                        ) : null}
                        {actions.map(
                            ({
                                key,
                                label,
                                icon: Icon,
                                destructive,
                                onClick,
                            }) => (
                                <Button
                                    key={key}
                                    variant="ghost"
                                    size="icon"
                                    className="group size-8 p-0"
                                    title={label}
                                    onClick={onClick}
                                >
                                    <Icon
                                        className={cn(
                                            'size-4',
                                            destructive
                                                ? 'text-red-500 group-hover:text-red-700'
                                                : 'text-blue-500 group-hover:text-blue-700',
                                        )}
                                    />
                                </Button>
                            ),
                        )}
                    </div>
                );
            }

            return (
                <div className="flex items-center justify-end gap-2">
                    {rowLocales?.length ? (
                        <LocaleBadges locales={rowLocales} />
                    ) : null}
                    <RowActionsMenu
                        iconClassName="size-3.5"
                        items={actions.map(
                            ({ label, icon, destructive, onClick }) => ({
                                label,
                                icon,
                                destructive,
                                onSelect: onClick,
                            }),
                        )}
                    />
                </div>
            );
        },
    };
}
