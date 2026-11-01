import type { Table } from '@tanstack/react-table';
import {
    Copy,
    Download,
    Search,
    SlidersHorizontal,
    Trash2,
    Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { ExportOptions } from '@/components/dialog/export-dialog';
import { ExportDialog } from '@/components/dialog/export-dialog';
import type { ImportOptions } from '@/components/dialog/import-dialog';
import { ImportDialog } from '@/components/dialog/import-dialog';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useHeaderActions } from '@/contexts/header-actions';
import '@/types';

type ActionButton = {
    key: string;
    label: string;
    icon?: typeof Copy;
    variant?: 'outline' | 'destructive';
    onClick: () => void;
};

export function DataTableToolbar<TData>({
    table,
    searchPlaceholder = 'Tìm kiếm...',
    hideSearch,
    searchValue,
    onSearchChange,
    filterSlot,
    toolbarActions,
    onCreate,
    onImport,
    onExport,
    onDeleteSelected,
    onDuplicateSelected,
}: {
    table: Table<TData>;
    searchPlaceholder?: string;
    hideSearch?: boolean;
    /** * Controlled search value for server-side search. */
    searchValue?: string;
    onSearchChange?: (value: string) => void;
    filterSlot?: ReactNode;
    toolbarActions?: ReactNode;
    onCreate?: () => void;
    onImport?: (file: File, options: ImportOptions) => void;
    /** * `rows` is empty for "all_items" — the caller re-queries server-side. */
    onExport?: (options: ExportOptions, rows: TData[]) => void;
    onDeleteSelected?: (rows: TData[]) => void;
    onDuplicateSelected?: (rows: TData[]) => void;
}) {
    const selectedRows = table.getFilteredSelectedRowModel().rows;
    const hasSelection = selectedRows.length > 0;
    const hideableColumns = table
        .getAllColumns()
        .filter((column) => column.getCanHide());
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [importDialogOpen, setImportDialogOpen] = useState(false);

    const importAction: ActionButton | false = !!onImport && {
        key: 'import',
        label: 'Nhập',
        icon: Upload,
        variant: 'outline',
        onClick: () => setImportDialogOpen(true),
    };
    const exportAction: ActionButton | false = !!onExport && {
        key: 'export',
        label: 'Xuất',
        icon: Download,
        variant: 'outline',
        onClick: () => setExportDialogOpen(true),
    };

    const selectionActions = (
        [
            onDuplicateSelected && {
                key: 'duplicate',
                label: 'Nhân bản',
                icon: Copy,
                variant: 'outline' as const,
                onClick: () =>
                    onDuplicateSelected(
                        selectedRows.map((row) => row.original),
                    ),
            },
            onDeleteSelected && {
                key: 'delete',
                label: 'Xóa',
                icon: Trash2,
                variant: 'destructive' as const,
                onClick: () => {
                    onDeleteSelected(selectedRows.map((row) => row.original));
                    table.toggleAllRowsSelected(false);
                },
            },
            exportAction,
        ] as (ActionButton | false)[]
    ).filter((action): action is ActionButton => Boolean(action));

    const defaultActions = (
        [
            importAction,
            exportAction,
            onCreate && { key: 'create', label: 'Tạo mới', onClick: onCreate },
        ] as (ActionButton | false)[]
    ).filter((action): action is ActionButton => Boolean(action));

    const renderActionButtons = (actions: ActionButton[]) =>
        actions.map(({ key, label, icon: Icon, variant, onClick }) => (
            <Button
                key={key}
                variant={variant}
                size="sm"
                className="h-8"
                onClick={onClick}
            >
                {Icon && <Icon className="size-4" />}
                {label}
            </Button>
        ));

    const headerActionsBar = hasSelection ? (
        <>
            <span className="text-sm text-muted-foreground">
                Đã chọn {selectedRows.length} dòng
            </span>
            {renderActionButtons(selectionActions)}
        </>
    ) : (
        <>
            {renderActionButtons(defaultActions)}
            {toolbarActions}
        </>
    );

    // ! List every value the buttons close over, or header actions run against a stale snapshot.
    useHeaderActions(headerActionsBar, [
        hasSelection,
        selectedRows,
        onCreate,
        onImport,
        onExport,
        onDeleteSelected,
        onDuplicateSelected,
        toolbarActions,
    ]);

    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            {hideSearch ? (
                <div className="flex-1" />
            ) : (
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={
                            onSearchChange
                                ? (searchValue ?? '')
                                : ((table.getState().globalFilter as string) ??
                                  '')
                        }
                        onChange={(event) =>
                            onSearchChange
                                ? onSearchChange(event.target.value)
                                : table.setGlobalFilter(event.target.value)
                        }
                        aria-label={searchPlaceholder}
                        placeholder={searchPlaceholder}
                        className="h-9 rounded-sm pl-8"
                    />
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {filterSlot}
                {hideableColumns.length === 1 ? (
                    (() => {
                        const [column] = hideableColumns;

                        return (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 rounded-sm capitalize"
                                onClick={() =>
                                    column.toggleVisibility(
                                        !column.getIsVisible(),
                                    )
                                }
                            >
                                <SlidersHorizontal className="size-4" />
                                {column.columnDef.meta?.label ?? column.id}
                            </Button>
                        );
                    })()
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 rounded-sm"
                            >
                                <SlidersHorizontal className="size-4" />
                                Cột
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                            {hideableColumns.map((column) => (
                                <DropdownMenuCheckboxItem
                                    key={column.id}
                                    className="capitalize"
                                    checked={column.getIsVisible()}
                                    onCheckedChange={(value) =>
                                        column.toggleVisibility(!!value)
                                    }
                                    onSelect={(event) => event.preventDefault()}
                                >
                                    {column.columnDef.meta?.label ?? column.id}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            {onImport && (
                <ImportDialog
                    open={importDialogOpen}
                    onOpenChange={setImportDialogOpen}
                    onConfirm={(file, options) => onImport(file, options)}
                />
            )}

            {onExport && (
                <ExportDialog
                    open={exportDialogOpen}
                    onOpenChange={setExportDialogOpen}
                    hasSelection={hasSelection}
                    onConfirm={(options) => {
                        const rows =
                            options.scope === 'selected'
                                ? selectedRows
                                : options.scope === 'current_page'
                                  ? table.getPaginationRowModel().rows
                                  : options.scope === 'current_filter'
                                    ? table.getFilteredRowModel().rows
                                    : [];

                        onExport(
                            options,
                            rows.map((row) => row.original),
                        );
                    }}
                />
            )}
        </div>
    );
}
