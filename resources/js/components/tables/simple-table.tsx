import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export type SimpleTableColumn<T> = {
    key: string;
    /** * Defaults to humanized `key` (`order_number` → "Order number"). */
    label?: string;
    align?: 'left' | 'right';
    type?: string;
    labelMap?: Record<string, string>;
    variant?:
        | Record<string, 'default' | 'destructive' | 'outline'>
        | ((value: string) => 'default' | 'destructive' | 'outline');
    render?: (row: T) => ReactNode;
};

export type SimpleTableQuery = {
    collection: string;
    filters?: Record<string, unknown>;
    /** * Each entry `col:asc`/`col:desc`, e.g. `['created_at:desc']`. */
    sorts?: string[];
    limit?: number;
};

type SimpleTableProps<T extends { id: string | number }> = {
    columns: SimpleTableColumn<T>[];
    title?: string;
    /** * Provide exactly one of `data`, `query` or `resolveQuery`. */
    data?: T[] | null;
    query?: SimpleTableQuery;
    /** * Async `query` for queries that depend on another fetch; re-runs when `resolveKey` changes (required). */
    resolveQuery?: () => Promise<SimpleTableQuery>;
    resolveKey?: string;
    linkTo?: (row: T) => string;
    loadingMessage?: string;
    emptyMessage?: string;
    /** * ! Must be this scroll container (it's the sticky header's containing block because of `overflow-x-auto`), not a wrapper. */
    containerClassName?: string;
};

function defaultRender<T>(row: T, column: SimpleTableColumn<T>): ReactNode {
    const value = (row as Record<string, unknown>)[column.key];

    if (column.key.startsWith('is_') && typeof value === 'boolean') {
        return <Checkbox checked={value} className="pointer-events-none" />;
    }

    if (value === null || value === undefined || value === '') {
        return '—';
    }

    const type = column.type;

    if (type) {
        if (type.startsWith('price')) {
            const currency = type.split(':')[1] || 'VND';

            return `${Number(value).toLocaleString('vi-VN')} ${currency}`;
        }

        if (type === 'date') {
            return formatDateTime(String(value));
        }

        if (type === 'badge') {
            const variantOption = column.variant;
            const resolveVariant =
                typeof variantOption === 'function'
                    ? variantOption
                    : (val: string) => variantOption?.[val];
            const variant = resolveVariant(String(value));

            return (
                <Badge variant={variant === 'default' ? undefined : variant}>
                    {column.labelMap?.[String(value)] ?? String(value)}
                </Badge>
            );
        }
    }

    return String(value);
}

function humanizeKey(key: string): string {
    const words = key.split(/[._-]/).join(' ');

    return words.charAt(0).toUpperCase() + words.slice(1);
}

function toParams(query: SimpleTableQuery): Record<string, unknown> {
    return { filter: query.filters, sorts: query.sorts, limit: query.limit };
}

/** * `createBadgeColumn` equivalent for SimpleTable. */
export function badgeColumn<T>(
    key: keyof T & string,
    label: string,
    options: {
        labelMap?: Record<string, string>;
        variant?:
            | Record<string, 'default' | 'destructive' | 'outline'>
            | ((value: string) => 'default' | 'destructive' | 'outline');
    } = {},
): SimpleTableColumn<T> {
    const variantOption = options.variant;
    const resolveVariant =
        typeof variantOption === 'function'
            ? variantOption
            : (value: string) => variantOption?.[value];

    return {
        key,
        label,
        render: (row) => {
            const value = String((row as Record<string, unknown>)[key]);
            const variant = resolveVariant(value);

            return (
                <Badge variant={variant === 'default' ? undefined : variant}>
                    {options.labelMap?.[value] ?? value}
                </Badge>
            );
        },
    };
}

/** * Integer amount + currency field (default "currency"), e.g. `1.000.000 VND`. */
export function priceColumn<T>(
    key: keyof T & string,
    label: string,
    currencyKey: string | null = 'currency',
): SimpleTableColumn<T> {
    return {
        key,
        label,
        align: 'right',
        render: (row) => {
            const amount = (row as Record<string, unknown>)[key] as
                number | null;
            const currency = currencyKey
                ? (((row as Record<string, unknown>)[currencyKey] as
                      string | undefined) ?? currencyKey)
                : undefined;

            return amount == null
                ? '—'
                : `${Number(amount).toLocaleString('vi-VN')}${currency ? ` ${currency}` : ''}`;
        },
    };
}

export function dateColumn<T>(
    key: keyof T & string,
    label: string,
): SimpleTableColumn<T> {
    return {
        key,
        label,
        render: (row) => {
            const value = (row as Record<string, unknown>)[key] as
                string | null;

            return value ? formatDateTime(value) : '—';
        },
    };
}

export function idColumn<T extends { id: string | number }>(
    label = 'ID',
): SimpleTableColumn<T> {
    return { key: 'id', label, render: (row) => `#${row.id}` };
}

/** * Compact "open" link instead of an actions dropdown. */
export function actionColumn<T extends { id: string | number }>(
    href: (row: T) => string,
): SimpleTableColumn<T> {
    return {
        key: 'actions',
        label: '',
        align: 'right',
        render: (row) => (
            <a
                href={href(row)}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
                <ExternalLink className="size-3.5" />
            </a>
        ),
    };
}

/** * Read-only list for embedding in forms (addresses, related orders); no sorting, filtering or pagination. */
export default function SimpleTable<T extends { id: string | number }>({
    columns,
    title,
    data: providedData,
    query,
    resolveQuery,
    resolveKey,
    linkTo,
    loadingMessage = 'Đang tải...',
    emptyMessage = 'Không có dữ liệu.',
    containerClassName,
}: SimpleTableProps<T>) {
    const [fetched, setFetched] = useState<{ key: string; data: T[] } | null>(
        null,
    );
    const currentKey = resolveQuery
        ? `resolve:${resolveKey}`
        : query
          ? JSON.stringify(query)
          : '';

    useEffect(() => {
        if (!query && !resolveQuery) {
            return;
        }

        let cancelled = false;

        const request = resolveQuery
            ? resolveQuery()
            : Promise.resolve(query as SimpleTableQuery);

        request
            .then((resolvedQuery) =>
                api.get(
                    window.route('items.index', {
                        resource: resolvedQuery.collection,
                    }),
                    { params: toParams(resolvedQuery) },
                ),
            )
            .then((response) => {
                if (!cancelled) {
                    setFetched({
                        key: currentKey,
                        data: response.data.data ?? [],
                    });
                }
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- currentKey is the stable dep for `query`/`resolveQuery`
    }, [currentKey]);

    // * Treat the in-flight window as loading instead of flashing the previous query's rows.
    const data =
        query || resolveQuery
            ? fetched?.key === currentKey
                ? fetched.data
                : null
            : (providedData ?? null);

    const heading = title && (
        <h3 className="mb-4 border-b pb-2 text-base font-semibold text-foreground">
            {title}
        </h3>
    );

    if (data === null) {
        return (
            <div>
                {heading}
                <p className="py-4 text-center text-sm text-muted-foreground">
                    {loadingMessage}
                </p>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div>
                {heading}
                <p className="py-4 text-center text-sm text-muted-foreground">
                    {emptyMessage}
                </p>
            </div>
        );
    }

    return (
        <div>
            {heading}
            <Table containerClassName={containerClassName}>
                <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                        {columns.map((column) => (
                            <TableHead
                                key={column.key}
                                className={
                                    column.align === 'right'
                                        ? 'text-right'
                                        : undefined
                                }
                            >
                                {column.label ?? humanizeKey(column.key)}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {data.map((row) => (
                        <TableRow key={row.id}>
                            {columns.map((column, index) => {
                                const content = column.render
                                    ? column.render(row)
                                    : defaultRender(row, column);

                                return (
                                    <TableCell
                                        key={column.key}
                                        className={
                                            column.align === 'right'
                                                ? 'text-right'
                                                : undefined
                                        }
                                    >
                                        {index === 0 && linkTo ? (
                                            <a
                                                href={linkTo(row)}
                                                className="font-medium text-foreground hover:underline"
                                            >
                                                {content}
                                            </a>
                                        ) : (
                                            content
                                        )}
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
