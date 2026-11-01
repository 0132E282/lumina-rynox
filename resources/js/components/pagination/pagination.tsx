import type { Table } from '@tanstack/react-table';
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

export function Pagination<TData>({
    table,
    rowCount,
    pageSizeOptions = [15, 30, 50, 100],
}: {
    table: Table<TData>;
    rowCount?: number;
    pageSizeOptions?: number[];
}) {
    const { pageIndex, pageSize } = table.getState().pagination;
    const pageCount = table.getPageCount();
    const total = rowCount ?? table.getFilteredRowModel().rows.length;
    const selected = table.getFilteredSelectedRowModel().rows.length;
    const rangeStart = total === 0 ? 0 : pageIndex * pageSize + 1;
    const rangeEnd = Math.min(total, (pageIndex + 1) * pageSize);

    return (
        <div className="mt-2 flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                <div className="text-sm text-muted-foreground">
                    {selected > 0
                        ? `${selected}/${total} dòng được chọn`
                        : `Hiển thị kết quả từ ${rangeStart} - ${rangeEnd} trên tổng ${total}`}
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <Select
                        value={String(pageSize)}
                        onValueChange={(value) =>
                            table.setPageSize(Number(value))
                        }
                    >
                        <SelectTrigger className="h-8 w-16">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {pageSizeOptions.map((size) => (
                                <SelectItem key={size} value={String(size)}>
                                    {size}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="flex items-center justify-between gap-6 sm:justify-start">
                <div className="text-sm text-muted-foreground">
                    Trang {pageIndex + 1} / {Math.max(pageCount, 1)}
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => table.setPageIndex(0)}
                        disabled={!table.getCanPreviousPage()}
                    >
                        <ChevronsLeft className="size-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                    >
                        <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                    >
                        <ChevronRight className="size-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => table.setPageIndex(pageCount - 1)}
                        disabled={!table.getCanNextPage()}
                    >
                        <ChevronsRight className="size-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
