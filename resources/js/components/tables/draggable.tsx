import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Cell, Header } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { GripVertical } from 'lucide-react';
import { TableCell, TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export function DraggableTableHeader<TData, TValue>({
    header,
}: {
    header: Header<TData, TValue>;
}) {
    const {
        attributes,
        listeners,
        isDragging,
        setNodeRef,
        transform,
        transition,
    } = useSortable({
        id: header.column.id,
    });

    return (
        <TableHead
            ref={setNodeRef}
            className={cn('group/head', isDragging && 'z-20 bg-muted')}
            style={{
                transform: CSS.Translate.toString(transform),
                transition,
                opacity: isDragging ? 0.8 : 1,
                width: header.getSize(),
            }}
        >
            <div className="flex items-center justify-between gap-1">
                {header.isPlaceholder
                    ? null
                    : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                      )}
                <button
                    type="button"
                    className="shrink-0 cursor-grab touch-none opacity-0 group-hover/head:opacity-60 hover:opacity-100 active:cursor-grabbing"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="size-3.5" />
                </button>
            </div>
        </TableHead>
    );
}

export function DragAlongCell<TData, TValue>({
    cell,
}: {
    cell: Cell<TData, TValue>;
}) {
    const { isDragging, setNodeRef, transform, transition } = useSortable({
        id: cell.column.id,
    });

    return (
        <TableCell
            ref={setNodeRef}
            className={cn(isDragging && 'z-10 bg-muted')}
            style={{
                transform: CSS.Translate.toString(transform),
                transition,
                opacity: isDragging ? 0.8 : 1,
                width: cell.column.getSize(),
            }}
        >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
    );
}
