import { Head, Link, router, usePage } from '@inertiajs/react';
import type {
    CellContext,
    ColumnDef,
    PaginationState,
} from '@tanstack/react-table';
import { ChevronRight } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm-dialog';
import type { ImportOptions } from '@/components/dialog/import-dialog';
import type {
    BadgeColor,
    ColumnConfig,
    LocaleStatus,
} from '@/components/tables/columns';
import {
    createActionsColumn,
    createColumns,
    createSelectColumn,
} from '@/components/tables/columns';
import { DashboardCards } from '@/components/tables/dashboard-cards';
import type { DashboardCardConfig } from '@/components/tables/dashboard-cards';
import { DataTable } from '@/components/tables/data-table';
import type {
    FilterCondition,
    FilterMatch,
} from '@/components/tables/data-table-filter';
import { VALUELESS_OPERATORS } from '@/components/tables/data-table-filter';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/contexts/locale-context';
import { useDebounce } from '@/hooks/use-debounce';
import { useQuery } from '@/hooks/use-query';
import { api } from '@/lib/api';
import { currentCollection, resourceRoute } from '@/lib/resource-route';
import { cn, formatDateTime } from '@/lib/utils';

/** * Added by `buildTreeRows`, read by the indent/toggle cell. */
type TreeRow<T> = T & { __depth: number; __hasChildren: boolean };

/** * Flattens rows into parent-then-children order with depth; children of collapsed parents are omitted. */
function buildTreeRows<T extends { id: string | number }>(
    rows: T[],
    parentField: keyof T,
    expanded: Set<string | number>,
): TreeRow<T>[] {
    const byParent = new Map<string | number | null, T[]>();

    rows.forEach((row) => {
        const parent =
            (row[parentField] as unknown as string | number | null) ?? null;
        const siblings = byParent.get(parent) ?? [];

        siblings.push(row);
        byParent.set(parent, siblings);
    });

    const out: TreeRow<T>[] = [];

    const walk = (parent: string | number | null, depth: number) => {
        for (const row of byParent.get(parent) ?? []) {
            const children = byParent.get(row.id) ?? [];

            out.push({
                ...row,
                __depth: depth,
                __hasChildren: children.length > 0,
            });

            if (children.length > 0 && expanded.has(row.id)) {
                walk(row.id, depth + 1);
            }
        }
    };

    walk(null, 0);

    return out;
}

type RawMultilingualValue = Partial<Record<string, string | null>>;

function localeStatusesOf(
    value: unknown,
    localesList: string[],
): LocaleStatus[] {
    if (!value || typeof value !== 'object') {
        return [];
    }

    const raw = value as RawMultilingualValue;

    return localesList.map((code) => ({ code, filled: Boolean(raw[code]) }));
}

type RemoteOptionEntry = {
    value: string;
    label?: string;
    text?: string;
    background?: string;
};
type RemoteOptions = Record<string, RemoteOptionEntry[]>;

function useRemoteBadgeOptions(
    collection: string,
    fields: string[],
): RemoteOptions {
    const [options, setOptions] = useState<RemoteOptions>({});
    const fieldsKey = fields.join(',');

    useEffect(() => {
        if (!fieldsKey) {
            return;
        }

        let cancelled = false;

        Promise.all(
            fieldsKey.split(',').map((field) =>
                api
                    .get<{ data: RemoteOptionEntry[] }>(
                        window.route('items.source', {
                            resource: collection,
                            field,
                        }),
                    )
                    .then((response) => [field, response.data.data] as const),
            ),
        ).then((entries) => {
            if (!cancelled) {
                setOptions(Object.fromEntries(entries));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [collection, fieldsKey]);

    return options;
}

export type PageConfig<T extends { id: string | number; name?: string }> = {
    title: string;
    columns: ColumnConfig<T>[];
    dashboards?: DashboardCardConfig[];
    collection?: string;
    data?: T[];
    searchPlaceholder?: string;
    query?: Record<string, unknown>;
    /** * Each entry `col:asc`/`col:desc`, e.g. `['created_at:desc']`. */
    defaultSort?: string[];
    localeField?: keyof T & string;
    /** * Parent-id column: renders a collapsible tree and loads every row up front (no server pagination). */
    treeField?: keyof T & string;
    actions?: {
        create?: boolean;
        import?: boolean;
        export?: boolean;
        delete?: boolean;
        search?: boolean;
        trash?: boolean;
    };
    export?: {
        collection?: string;
        fields?: string[];
    };
};

/** * Server-side filter in the index endpoint's `filter[field][operator]` shape. */
export type IndexFilter = Record<string, Record<string, unknown>>;

/** * Live list state handed to `renderAbove`, e.g. so a summary can follow the table's own search and filters. */
export type IndexRenderContext = {
    search: string;
    filter: IndexFilter | undefined;
    total: number;
};

/** * Lets a page reload the list after it changes a row itself (quick add, inline toggle). */
export type IndexHandle = { refetch: () => void };

/** * Per-field merge: operators the user picked in the filter popover win over the page's fixed ones. */
function mergeFilters(
    base: unknown,
    advanced: IndexFilter | undefined,
): IndexFilter | undefined {
    const fixed =
        base && typeof base === 'object' ? (base as IndexFilter) : undefined;

    if (!fixed) {
        return advanced;
    }

    const merged: IndexFilter = { ...fixed };

    Object.entries(advanced ?? {}).forEach(([field, operators]) => {
        merged[field] = { ...merged[field], ...operators };
    });

    return merged;
}

interface IndexLayoutProps<T extends { id: string | number; name?: string }> {
    config?: PageConfig<T>;
    ref?: Ref<IndexHandle>;
    emptyMessage?: string;
    /** * Called with the debounced server-side search term, e.g. to highlight matches in cells. */
    onSearchTermChange?: (term: string) => void;
    title?: string;
    columns?: ColumnDef<T>[];
    data?: T[];
    collection?: string;
    searchPlaceholder?: string;
    enableImport?: boolean;
    enableExport?: boolean;
    enableDelete?: boolean;
    enableCreate?: boolean;
    enableSearch?: boolean;
    exportFields?: string[];
    exportCollection?: string;
    renderAbove?: (data: T[], context: IndexRenderContext) => ReactNode;
    query?: Record<string, unknown>;
    enableTrash?: boolean;
    /** * Each entry `col:asc`/`col:desc`, e.g. `['created_at:desc']`. */
    defaultSort?: string[];
}

export default function IndexLayout<
    T extends { id: string | number; name?: string },
>(props: IndexLayoutProps<T>) {
    const { config } = props;
    const { locales: sharedLocales } = usePage<{
        locales?: { code: string; is_default: boolean }[];
    }>().props;
    const localesList = useMemo(
        () => sharedLocales?.map((entry) => entry.code) ?? ['vi', 'en'],
        [sharedLocales],
    );
    const defaultLocale = useMemo(
        () => sharedLocales?.find((entry) => entry.is_default)?.code ?? 'vi',
        [sharedLocales],
    );

    const { ref, emptyMessage, onSearchTermChange } = props;
    const resolvedCollectionFromUrl = currentCollection(usePage().url);
    const resolvedCollection =
        config?.collection ?? props.collection ?? resolvedCollectionFromUrl;

    const [trashed, setTrashed] = useState(false);
    const title = config?.title ?? props.title ?? '';
    const localeField = config?.localeField;
    const treeField = config?.treeField;
    const [locale] = useLocale();

    // * Collapsed by default.
    const [expandedIds, setExpandedIds] = useState<Set<string | number>>(
        new Set(),
    );
    const toggleExpanded = (id: string | number) => {
        setExpandedIds((current) => {
            const next = new Set(current);

            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }

            return next;
        });
    };

    const remoteBadgeFields = useMemo(
        () =>
            config
                ? config.columns
                      .filter(
                          (
                              column,
                          ): column is ColumnConfig<T> & { type: 'badge' } =>
                              column.type === 'badge' && !column.labelMap,
                      )
                      .map((column): string => column.accessorKey)
                : [],
        [config],
    );
    const remoteBadgeOptions = useRemoteBadgeOptions(
        resolvedCollection,
        remoteBadgeFields,
    );

    const baseColumns = useMemo<ColumnDef<T>[]>(() => {
        if (!config) {
            return props.columns ?? [];
        }

        const columns = createColumns<T>(
            (trashed
                ? config.columns.map((column) =>
                      column.type === 'link'
                          ? { ...column, type: 'text' as const }
                          : { ...column, link: undefined },
                  )
                : config.columns
            ).map((column) => {
                if (column.type !== 'badge' || column.labelMap) {
                    return column;
                }

                const remote =
                    remoteBadgeOptions[column.accessorKey as string] ?? [];
                const labelMap = Object.fromEntries(
                    remote.map((entry) => [
                        entry.value,
                        entry.label ?? entry.value,
                    ]),
                );
                const colors = Object.fromEntries(
                    remote
                        .filter((entry) => entry.text && entry.background)
                        .map((entry) => [
                            entry.value,
                            {
                                text: entry.text,
                                background: entry.background,
                            } as BadgeColor,
                        ]),
                );

                return {
                    ...column,
                    labelMap,
                    variant: column.variant ?? {},
                    colors,
                };
            }),
        );

        const localeConfigColumn =
            !trashed && localeField
                ? config.columns.find(
                      (column) =>
                          'accessorKey' in column &&
                          column.accessorKey === localeField,
                  )
                : undefined;
        const localeLink =
            localeConfigColumn &&
            ('link' in localeConfigColumn
                ? localeConfigColumn.link
                : localeConfigColumn.type === 'link'
                  ? true
                  : undefined);
        const localeHref =
            typeof localeLink === 'function'
                ? localeLink
                : localeLink
                  ? (row: T) => resourceRoute(resolvedCollectionFromUrl, row.id)
                  : undefined;

        const withLocaleCell = localeField
            ? columns.map((column) =>
                  'accessorKey' in column && column.accessorKey === localeField
                      ? {
                            ...column,
                            cell: ({ row }: { row: { original: T } }) => {
                                const raw = row.original[
                                    localeField
                                ] as unknown as
                                    RawMultilingualValue | undefined;
                                const text =
                                    raw?.[locale] ??
                                    raw?.[defaultLocale] ??
                                    Object.values(raw ?? {}).find(Boolean) ??
                                    '-';

                                return localeHref ? (
                                    <Link
                                        href={localeHref(row.original)}
                                        className="font-medium text-blue-600 dark:text-blue-400"
                                    >
                                        {text}
                                    </Link>
                                ) : (
                                    text
                                );
                            },
                        }
                      : column,
              )
            : columns;

        // * Tree indent and toggle wrap the label column (the locale column, else the first column).
        const treeTargetKey =
            treeField &&
            (localeField ??
                (config.columns[0] && 'accessorKey' in config.columns[0]
                    ? config.columns[0].accessorKey
                    : undefined));
        const withTree = treeTargetKey
            ? withLocaleCell.map((column) =>
                  'accessorKey' in column &&
                  column.accessorKey === treeTargetKey
                      ? {
                            ...column,
                            cell: (ctx: CellContext<T, unknown>) => {
                                const row = ctx.row.original as TreeRow<T>;
                                const isOpen = expandedIds.has(row.id);
                                const original = column.cell;

                                return (
                                    <div
                                        className="flex items-center gap-1"
                                        style={{
                                            paddingLeft: `${(row.__depth ?? 0) * 1.5}rem`,
                                        }}
                                    >
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleExpanded(row.id);
                                            }}
                                            className={cn(
                                                'flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted',
                                                !row.__hasChildren &&
                                                    'invisible',
                                            )}
                                        >
                                            <ChevronRight
                                                className={cn(
                                                    'size-3.5 transition-transform',
                                                    isOpen && 'rotate-90',
                                                )}
                                            />
                                        </button>
                                        {typeof original === 'function'
                                            ? original(ctx)
                                            : ((ctx.getValue() as ReactNode) ??
                                              '-')}
                                    </div>
                                );
                            },
                        }
                      : column,
              )
            : withLocaleCell;

        if (!trashed) {
            return withTree;
        }

        return [
            ...withTree,
            {
                id: 'deleted_at',
                meta: { label: 'Ngày xóa' },
                header: 'Ngày xóa',
                cell: ({ row }) => {
                    const deletedAt = (row.original as { deleted_at?: string })
                        .deleted_at;

                    return deletedAt ? formatDateTime(deletedAt) : '-';
                },
            },
        ];
    }, [
        config,
        props.columns,
        trashed,
        localeField,
        treeField,
        expandedIds,
        locale,
        resolvedCollectionFromUrl,
        remoteBadgeOptions,
        defaultLocale,
    ]);

    const data = config?.data ?? props.data;
    const searchPlaceholder =
        config?.searchPlaceholder ?? props.searchPlaceholder;
    const resolveAction = <
        K extends keyof NonNullable<PageConfig<T>['actions']>,
    >(
        key: K,
        flatValue: boolean | undefined,
    ) => (config ? config.actions?.[key] : flatValue);
    const enableImport = resolveAction('import', props.enableImport);
    const enableExport = resolveAction('export', props.enableExport);
    const enableDelete = resolveAction('delete', props.enableDelete) ?? true;
    const enableCreate = resolveAction('create', props.enableCreate) ?? true;
    const enableSearch = resolveAction('search', props.enableSearch) ?? true;
    const exportCollection =
        config?.export?.collection ?? props.exportCollection;
    const query = config?.query ?? props.query;
    const enableTrash = resolveAction('trash', props.enableTrash) ?? false;
    const renderAbove = config?.dashboards
        ? () => (
              <DashboardCards
                  cards={config.dashboards!}
                  collection={resolvedCollection}
              />
          )
        : props.renderAbove;

    const exportFields =
        config?.export?.fields ??
        (config
            ? config.columns
                  .map((column) =>
                      'accessorKey' in column
                          ? String(column.accessorKey)
                          : null,
                  )
                  .filter((key) => key !== null)
            : props.exportFields);

    const resolvedExportCollection = exportCollection ?? resolvedCollection;
    const usesGenericApi = data === undefined;
    const canImport = enableImport ?? !usesGenericApi;
    const canExport = enableExport ?? !usesGenericApi;
    const canDuplicate = !usesGenericApi;

    const [sorts, setSorts] = useState<string[] | undefined>(
        config?.defaultSort ?? props.defaultSort,
    );
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: 15,
    });
    const [searchInput, setSearchInput] = useState('');
    const search = useDebounce(searchInput, 300);
    const [filterConditions, setFilterConditions] = useState<FilterCondition[]>(
        [],
    );
    const [filterMatch, setFilterMatch] = useState<FilterMatch>('all');

    // ! Only `match: 'all'` goes to the backend (AND-only); `match: 'any'` is filtered client-side on the current page.
    const advancedFilter = useMemo(() => {
        if (filterMatch !== 'all') {
            return undefined;
        }

        const active = filterConditions.filter(
            (condition) =>
                condition.field &&
                (VALUELESS_OPERATORS.includes(condition.operator) ||
                    condition.value),
        );

        if (!active.length) {
            return undefined;
        }

        return active.reduce<
            Record<string, Record<string, string | number | string[]>>
        >((acc, condition) => {
            const value = VALUELESS_OPERATORS.includes(condition.operator)
                ? 1
                : condition.value;
            acc[condition.field] = {
                ...acc[condition.field],
                [condition.operator]: value,
            };

            return acc;
        }, {});
    }, [filterConditions, filterMatch]);

    const fields = useMemo(
        () => [
            'id',
            ...(trashed ? ['deleted_at'] : []),
            ...(treeField && treeField !== 'id' ? [String(treeField)] : []),
            ...baseColumns
                .map((column) =>
                    'accessorKey' in column ? String(column.accessorKey) : null,
                )
                .filter((key) => key !== null)
                .map((key) => (key === localeField ? `${key}->toRaw` : key)),
        ],
        [baseColumns, trashed, localeField, treeField],
    );

    const { filter: fixedFilter, ...otherQuery } = query ?? {};
    const requestFilter = mergeFilters(fixedFilter, advancedFilter);

    useEffect(() => {
        onSearchTermChange?.(search);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    // * Trees load every row (`limit: -1`); search then filters client-side.
    const { data: response, refetch } = useQuery<{
        data: T[];
        meta: { total: number };
    }>(usesGenericApi ? 'items.index' : null, {
        resource: resolvedCollection,
        sorts: treeField ? undefined : sorts,
        page: treeField ? undefined : pagination.pageIndex + 1,
        limit: treeField ? -1 : pagination.pageSize,
        fields,
        locale,
        search: treeField ? undefined : search || undefined,
        ...(trashed ? { trashed: 1 } : {}),
        ...(requestFilter ? { filter: requestFilter } : {}),
        ...otherQuery,
    });

    useImperativeHandle(ref, () => ({ refetch }));

    const flatData = data ?? response?.data ?? [];
    const resolvedData = useMemo(
        () =>
            treeField
                ? buildTreeRows(flatData, treeField, expandedIds)
                : flatData,
        [treeField, flatData, expandedIds],
    );
    const rowCount = treeField
        ? resolvedData.length
        : (response?.meta?.total ?? 0);
    const pageCount = treeField
        ? 1
        : Math.max(1, Math.ceil(rowCount / pagination.pageSize));

    const rowLabel = (row: T) =>
        row.name ??
        ('title' in row && typeof row.title === 'string' ? row.title : row.id);

    const confirm = useConfirm();
    const confirmDelete = (title: string) =>
        confirm({
            title,
            description: 'Hành động này không thể hoàn tác.',
            confirmLabel: 'Xóa',
            destructive: true,
        });

    const runApiAction = async (
        action: () => Promise<unknown>,
        successMessage: string,
        errorMessage: string,
    ) => {
        try {
            await action();
            refetch();
            toast.success(successMessage);
        } catch {
            toast.error(errorMessage);
        }
    };

    const deleteRows = async (ids: (string | number)[]) => {
        const successMessage =
            ids.length > 1 ? `Đã xóa ${ids.length} mục.` : 'Đã xóa.';
        const onError = () => toast.error('Xóa thất bại.');

        if (usesGenericApi) {
            await runApiAction(
                () =>
                    Promise.all(
                        ids.map((id) =>
                            api.delete(
                                window.route('items.destroy', {
                                    resource: resolvedCollection,
                                    id,
                                }),
                            ),
                        ),
                    ),
                successMessage,
                'Xóa thất bại.',
            );

            return;
        }

        if (ids.length > 1) {
            router.post(
                window.route(`${resolvedCollection}.bulk-destroy`),
                { ids },
                {
                    preserveScroll: true,
                    onSuccess: () => toast.success(successMessage),
                    onError,
                },
            );

            return;
        }

        router.delete(window.route(`${resolvedCollection}.destroy`, ids[0]), {
            preserveScroll: true,
            onSuccess: () => toast.success(successMessage),
            onError,
        });
    };

    const duplicateRows = (ids: (string | number)[]) => {
        router.post(
            window.route(`${resolvedCollection}.bulk-duplicate`),
            { ids },
            {
                preserveScroll: true,
                onSuccess: () => toast.success('Đã nhân bản.'),
            },
        );
    };

    const restoreRow = (id: string | number) =>
        runApiAction(
            () =>
                api.post(
                    window.route('items.restore', {
                        resource: resolvedCollection,
                        id,
                    }),
                ),
            'Đã khôi phục.',
            'Khôi phục thất bại.',
        );

    const forceDeleteRow = async (id: string | number) => {
        const ok = await confirm({
            title: 'Xóa vĩnh viễn?',
            description:
                'Hành động này không thể hoàn tác — dữ liệu sẽ bị xóa hẳn khỏi hệ thống.',
            confirmLabel: 'Xóa vĩnh viễn',
            destructive: true,
        });

        if (!ok) {
            return;
        }

        await runApiAction(
            () =>
                api.delete(
                    window.route('items.force-destroy', {
                        resource: resolvedCollection,
                        id,
                    }),
                ),
            'Đã xóa vĩnh viễn.',
            'Xóa thất bại.',
        );
    };

    const rowLocales = localeField
        ? (row: T) => localeStatusesOf(row[localeField], localesList)
        : undefined;

    const columns = useMemo<ColumnDef<T>[]>(
        () => [
            createSelectColumn<T>(),
            ...baseColumns,
            trashed
                ? createActionsColumn<T>({
                      onRestore: (row) => restoreRow(row.id),
                      onForceDelete: (row) => forceDeleteRow(row.id),
                      locales: rowLocales,
                  })
                : createActionsColumn<T>({
                      onDelete: enableDelete
                          ? async (row) => {
                                if (
                                    await confirmDelete(
                                        `Xóa "${rowLabel(row)}"?`,
                                    )
                                ) {
                                    await deleteRows([row.id]);
                                }
                            }
                          : undefined,
                      onDuplicate: canDuplicate
                          ? (row) => duplicateRows([row.id])
                          : undefined,
                      locales: rowLocales,
                  }),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            baseColumns,
            resolvedCollection,
            usesGenericApi,
            enableDelete,
            trashed,
            rowLocales,
        ],
    );

    const handleImportFile = (file: File, options: ImportOptions) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('locale', options.locale);

        router.post(window.route(`${resolvedCollection}.import`), formData, {
            forceFormData: true,
            preserveScroll: true,
            onSuccess: () => toast.success('Nhập dữ liệu thành công.'),
            onError: () => toast.error('Nhập dữ liệu thất bại.'),
        });
    };

    const resetPageIndex = () =>
        setPagination((current) => ({ ...current, pageIndex: 0 }));

    return (
        <div className="flex h-full min-w-0 flex-1 flex-col gap-5 p-4 md:p-6">
            <Head title={title} />

            {enableTrash && (
                <div className="w-full rounded-md border px-2">
                    <Tabs
                        value={trashed ? 'trash' : 'active'}
                        onValueChange={(value) => {
                            setTrashed(value === 'trash');
                            resetPageIndex();
                        }}
                    >
                        <TabsList variant="line">
                            <TabsTrigger value="active">Tất cả</TabsTrigger>
                            <TabsTrigger value="trash">Đã xóa</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
            )}

            {!trashed &&
                renderAbove?.(resolvedData, {
                    search,
                    filter: requestFilter,
                    total: rowCount,
                })}

            <DataTable
                columns={columns}
                data={resolvedData}
                emptyMessage={
                    emptyMessage && search
                        ? 'Không tìm thấy kết quả. Hãy đổi từ khoá hoặc xoá bộ lọc.'
                        : emptyMessage
                }
                searchPlaceholder={
                    searchPlaceholder ?? `Tìm kiếm ${title.toLowerCase()}...`
                }
                onSortChange={(nextSorts) => {
                    // * DataTable reports "no sort" on mount, which must not discard the page's default sort.
                    setSorts(
                        nextSorts ?? config?.defaultSort ?? props.defaultSort,
                    );
                    resetPageIndex();
                }}
                onSearchChange={
                    usesGenericApi && !treeField
                        ? (value) => {
                              setSearchInput(value);
                              resetPageIndex();
                          }
                        : undefined
                }
                onFilterChange={
                    usesGenericApi
                        ? (conditions, match) => {
                              setFilterConditions(conditions);
                              setFilterMatch(match);
                              resetPageIndex();
                          }
                        : undefined
                }
                hideCreate={trashed || !enableCreate}
                hideSearch={!enableSearch}
                {...(usesGenericApi
                    ? {
                          pagination,
                          onPaginationChange: setPagination,
                          pageCount,
                          rowCount,
                      }
                    : {})}
                onImport={!trashed && canImport ? handleImportFile : undefined}
                onExport={
                    !trashed && canExport
                        ? (options, rows) =>
                              window.open(
                                  window.route(
                                      `${resolvedExportCollection}.export`,
                                      {
                                          ...(exportFields?.length
                                              ? { fields: exportFields }
                                              : {}),
                                          format: options.format,
                                          locale: options.locale,
                                          ...(options.scope !== 'all_items'
                                              ? {
                                                    ids: rows.map(
                                                        (row) => row.id,
                                                    ),
                                                }
                                              : {}),
                                      },
                                  ),
                                  '_blank',
                              )
                        : undefined
                }
                onDeleteSelected={
                    !trashed && enableDelete
                        ? async (rows) => {
                              if (
                                  await confirmDelete(
                                      `Xóa ${rows.length} mục đã chọn?`,
                                  )
                              ) {
                                  await deleteRows(rows.map((row) => row.id));
                              }
                          }
                        : undefined
                }
                onDuplicateSelected={
                    !trashed && canDuplicate
                        ? (rows) => duplicateRows(rows.map((row) => row.id))
                        : undefined
                }
            />
        </div>
    );
}
