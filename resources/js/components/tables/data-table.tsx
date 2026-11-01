import type { DragEndEvent } from '@dnd-kit/core';
import {
    closestCenter,
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
    arrayMove,
    horizontalListSortingStrategy,
    SortableContext,
} from '@dnd-kit/sortable';
import { router, usePage } from '@inertiajs/react';
import type {
    ColumnDef,
    ColumnFiltersState,
    PaginationState,
    RowSelectionState,
    SortingState,
    VisibilityState,
} from '@tanstack/react-table';
import {
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { useEffect, useId, useMemo, useState } from 'react';
import type { ExportOptions } from '@/components/dialog/export-dialog';
import type { ImportOptions } from '@/components/dialog/import-dialog';
import { Pagination } from '@/components/pagination/pagination';
import type {
    FilterCondition,
    FilterMatch,
} from '@/components/tables/data-table-filter';
import {
    applyAdvancedFilter,
    DataTableFilterPopover,
} from '@/components/tables/data-table-filter';
import {
    DragAlongCell,
    DraggableTableHeader,
} from '@/components/tables/draggable';
import { DataTableToolbar } from '@/components/toolbar/data-table-toolbar';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { resourceRoute } from '@/lib/resource-route';
import '@/types';

const FIXED_COLUMN_IDS = ['select', 'actions'];

function getColumnId<TData, TValue>(column: ColumnDef<TData, TValue>): string {
    if (column.id) {
        return column.id;
    }

    if ('accessorKey' in column && typeof column.accessorKey === 'string') {
        return column.accessorKey.replace(/\./g, '_');
    }

    return String(column.header);
}

export function DataTable<TData, TValue>({
    columns,
    data,
    searchPlaceholder,
    emptyMessage = 'Không có dữ liệu.',
    toolbarActions,
    onCreate,
    hideCreate,
    hideSearch,
    onImport,
    onExport,
    onDeleteSelected,
    onDuplicateSelected,
    onSortChange,
    pagination: controlledPagination,
    onPaginationChange,
    pageCount,
    rowCount,
    onSearchChange,
    onFilterChange,
    selectionResetKey,
}: {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    searchPlaceholder?: string;
    emptyMessage?: string;
    toolbarActions?: ReactNode;
    onCreate?: () => void;
    hideCreate?: boolean;
    hideSearch?: boolean;
    /** * Server-side search: `data` is only the current result, so the caller refetches with `?search=`. */
    onSearchChange?: (search: string) => void;
    onImport?: (file: File, options: ImportOptions) => void;
    /** * `rows` is empty for the "all_items" scope. */
    onExport?: (options: ExportOptions, rows: TData[]) => void;
    onDeleteSelected?: (rows: TData[]) => void;
    onDuplicateSelected?: (rows: TData[]) => void;
    /** * Receives backend-ready `sorts` (`col:asc`/`col:desc`) to forward as a query param. */
    onSortChange?: (sorts: string[] | undefined) => void;
    /**
     * * Server-side filtering for `match: 'all'` (backend AND-chains conditions);
     * ! `match: 'any'` still filters only the current page client-side.
     */
    onFilterChange?: (
        conditions: FilterCondition[],
        match: FilterMatch,
    ) => void;
    /** * Passing all three enables server-side pagination (`data` = current page only). */
    pagination?: PaginationState;
    onPaginationChange?: (pagination: PaginationState) => void;
    pageCount?: number;
    rowCount?: number;
    /** * Server-driven pages re-use row indexes: when this changes (page, filter, total) the ticked rows are cleared. */
    selectionResetKey?: string;
}) {
    const instanceId = useId();
    const { url } = usePage();

    // * Collections live at `/{collection}`, so the create URL comes from the current path.
    const collection = url.split('?')[0].split('/').filter(Boolean)[0];
    const resolvedOnCreate = hideCreate
        ? undefined
        : (onCreate ??
          (collection
              ? () => router.visit(resourceRoute(collection, 'create'))
              : undefined));

    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
        {},
    );
    const [globalFilter, setGlobalFilter] = useState('');
    const [searchValue, setSearchValue] = useState('');
    const [columnOrder, setColumnOrder] = useState<string[]>(() => {
        const ids = columns.map((column) => getColumnId(column));
        const rest = ids.filter((id) => !FIXED_COLUMN_IDS.includes(id));

        return [
            ...ids.filter((id) => id === 'select'),
            ...rest,
            ...ids.filter((id) => id === 'actions'),
        ];
    });
    const manualPagination = !!controlledPagination && !!onPaginationChange;
    const [internalPagination, setInternalPagination] =
        useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
    const pagination = controlledPagination ?? internalPagination;
    const setPagination: typeof setInternalPagination = (updater) => {
        const next =
            typeof updater === 'function' ? updater(pagination) : updater;

        onPaginationChange
            ? onPaginationChange(next)
            : setInternalPagination(next);
    };
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
    const [filterConditions, setFilterConditions] = useState<FilterCondition[]>(
        [],
    );
    const [filterMatch, setFilterMatch] = useState<FilterMatch>('all');

    useEffect(() => {
        setRowSelection({});
    }, [selectionResetKey]);

    useEffect(() => {
        const sorts = sorting.length
            ? sorting.map((rule) => `${rule.id}:${rule.desc ? 'desc' : 'asc'}`)
            : undefined;
        onSortChange?.(sorts);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sorting]);

    useEffect(() => {
        setColumnOrder((prevOrder) => {
            const currentIds = columns.map((col) => getColumnId(col));
            const validPrevOrder = prevOrder.filter((id) =>
                currentIds.includes(id),
            );

            const missingIds = currentIds.filter(
                (id) => !validPrevOrder.includes(id),
            );

            if (
                missingIds.length === 0 &&
                validPrevOrder.length === prevOrder.length
            ) {
                return prevOrder;
            }

            const actionsIndex = validPrevOrder.indexOf('actions');
            const newNonFixed = missingIds.filter(
                (id) => !FIXED_COLUMN_IDS.includes(id),
            );

            let nextOrder: string[];

            if (actionsIndex !== -1) {
                nextOrder = [
                    ...validPrevOrder.slice(0, actionsIndex),
                    ...newNonFixed,
                    ...validPrevOrder.slice(actionsIndex),
                ];
            } else {
                nextOrder = [...validPrevOrder, ...newNonFixed];
            }

            if (
                currentIds.includes('select') &&
                !nextOrder.includes('select')
            ) {
                nextOrder.unshift('select');
            }

            if (
                currentIds.includes('actions') &&
                !nextOrder.includes('actions')
            ) {
                nextOrder.push('actions');
            }

            return nextOrder;
        });
    }, [columns]);

    const filterFields = useMemo(
        () =>
            columns
                .filter(
                    (column) => !FIXED_COLUMN_IDS.includes(getColumnId(column)),
                )
                .map((column) => ({
                    id: getColumnId(column),
                    label: column.meta?.label ?? getColumnId(column),
                    filterOptions: column.meta?.filterOptions,
                    filterRelation: column.meta?.filterRelation,
                    filterInputType: column.meta?.filterInputType,
                    filterMultiple: column.meta?.filterMultiple,
                })),
        [columns],
    );

    // * With server-side `match: 'all'`, `data` is already filtered.
    const serverFiltered = !!onFilterChange && filterMatch === 'all';
    const filteredData = useMemo(
        () =>
            serverFiltered
                ? data
                : applyAdvancedFilter(data, filterConditions, filterMatch),
        [data, filterConditions, filterMatch, serverFiltered],
    );

    const table = useReactTable({
        data: filteredData,
        columns,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
            globalFilter,
            columnOrder,
            pagination,
            rowSelection,
        },
        enableRowSelection: true,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        onGlobalFilterChange: setGlobalFilter,
        onColumnOrderChange: setColumnOrder,
        onPaginationChange: setPagination,
        onRowSelectionChange: setRowSelection,
        // * With `onSearchChange`, `data` is already the server's search result.
        manualFiltering: !!onSearchChange,
        manualPagination,
        pageCount: manualPagination ? (pageCount ?? -1) : undefined,
        rowCount: manualPagination ? rowCount : undefined,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: manualPagination
            ? undefined
            : getPaginationRowModel(),
    });

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (
            !over ||
            active.id === over.id ||
            FIXED_COLUMN_IDS.includes(over.id as string)
        ) {
            return;
        }

        setColumnOrder((prev) => {
            const oldIndex = prev.indexOf(active.id as string);
            const newIndex = prev.indexOf(over.id as string);

            return arrayMove(prev, oldIndex, newIndex);
        });
    };

    const columnIds = useMemo(
        () =>
            table
                .getAllLeafColumns()
                .map((column) => column.id)
                .filter((id) => !FIXED_COLUMN_IDS.includes(id)),
        [table],
    );

    return (
        <div className="flex h-full min-h-0 max-w-full min-w-0 flex-1 flex-col gap-3">
            <DataTableToolbar
                table={table}
                searchPlaceholder={searchPlaceholder}
                hideSearch={hideSearch}
                searchValue={onSearchChange ? searchValue : undefined}
                onSearchChange={
                    onSearchChange
                        ? (value) => {
                              setSearchValue(value);
                              onSearchChange(value);
                          }
                        : undefined
                }
                toolbarActions={toolbarActions}
                onCreate={resolvedOnCreate}
                onImport={onImport}
                onExport={onExport}
                onDeleteSelected={onDeleteSelected}
                onDuplicateSelected={onDuplicateSelected}
                filterSlot={
                    <DataTableFilterPopover
                        fields={filterFields}
                        conditions={filterConditions}
                        match={filterMatch}
                        onApply={(conditions, match) => {
                            setFilterConditions(conditions);
                            setFilterMatch(match);
                            onFilterChange?.(conditions, match);
                        }}
                    />
                }
            />

            <DndContext
                id={instanceId}
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToHorizontalAxis]}
                onDragEnd={handleDragEnd}
            >
                <div className="max-h-full w-full max-w-full overflow-auto rounded-lg border bg-card">
                    <Table
                        className="min-w-max"
                        containerClassName="overflow-visible"
                    >
                        <TableHeader>
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id}>
                                    <SortableContext
                                        items={columnIds}
                                        strategy={horizontalListSortingStrategy}
                                    >
                                        {headerGroup.headers.map((header) =>
                                            FIXED_COLUMN_IDS.includes(
                                                header.column.id,
                                            ) ? (
                                                <TableHead
                                                    key={header.id}
                                                    style={{
                                                        width: header.getSize(),
                                                    }}
                                                >
                                                    {header.isPlaceholder
                                                        ? null
                                                        : flexRender(
                                                              header.column
                                                                  .columnDef
                                                                  .header,
                                                              header.getContext(),
                                                          )}
                                                </TableHead>
                                            ) : (
                                                <DraggableTableHeader
                                                    key={header.id}
                                                    header={header}
                                                />
                                            ),
                                        )}
                                    </SortableContext>
                                </TableRow>
                            ))}
                        </TableHeader>
                        {/* * Short result sets don't fill the min-height box, so keep the last row's bottom border. */}
                        <TableBody
                            className={
                                table.getRowModel().rows.length
                                    ? '[&_tr:last-child]:border-b'
                                    : '[&_tr:last-child]:border-b-0'
                            }
                        >
                            {table.getRowModel().rows.length ? (
                                table.getRowModel().rows.map((row) => (
                                    <TableRow
                                        key={row.id}
                                        data-state={
                                            row.getIsSelected() && 'selected'
                                        }
                                    >
                                        {row.getVisibleCells().map((cell) =>
                                            FIXED_COLUMN_IDS.includes(
                                                cell.column.id,
                                            ) ? (
                                                <TableCell
                                                    key={cell.id}
                                                    style={{
                                                        width: cell.column.getSize(),
                                                    }}
                                                >
                                                    {flexRender(
                                                        cell.column.columnDef
                                                            .cell,
                                                        cell.getContext(),
                                                    )}
                                                </TableCell>
                                            ) : (
                                                <SortableContext
                                                    key={cell.id}
                                                    items={columnIds}
                                                    strategy={
                                                        horizontalListSortingStrategy
                                                    }
                                                >
                                                    <DragAlongCell
                                                        cell={cell}
                                                    />
                                                </SortableContext>
                                            ),
                                        )}
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow className="border-b-0 hover:bg-transparent">
                                    <TableCell
                                        colSpan={columns.length}
                                        className="h-24 text-center text-muted-foreground"
                                    >
                                        {emptyMessage}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </DndContext>
            <Pagination
                table={table}
                rowCount={manualPagination ? rowCount : undefined}
            />
        </div>
    );
}
