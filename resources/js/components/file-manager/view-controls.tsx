import { ArrowDownAZ, ArrowUpAZ, LayoutGrid, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type SortField = 'name' | 'created_at' | 'size';
export type ViewMode = 'grid' | 'table';

export const SORT_OPTIONS: { value: SortField; label: string }[] = [
    { value: 'name', label: 'Tên' },
    { value: 'created_at', label: 'Ngày tạo' },
    { value: 'size', label: 'Dung lượng' },
];

export function ViewControls({
    sort,
    direction,
    view,
    onSortChange,
    onViewChange,
}: {
    sort: SortField;
    direction: 'asc' | 'desc';
    view: ViewMode;
    onSortChange: (field: SortField) => void;
    onViewChange: (view: ViewMode) => void;
}) {
    const DirectionIcon = direction === 'asc' ? ArrowUpAZ : ArrowDownAZ;

    return (
        <div className="flex items-center gap-2">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                        <DirectionIcon className="size-4" />
                        {SORT_OPTIONS.find((option) => option.value === sort)
                            ?.label ?? 'Sắp xếp'}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {SORT_OPTIONS.map((option) => (
                        <DropdownMenuItem
                            key={option.value}
                            onClick={() => onSortChange(option.value)}
                        >
                            {option.value === sort && (
                                <DirectionIcon className="size-4" />
                            )}
                            {option.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center rounded-md border border-input p-0.5">
                <Button
                    type="button"
                    variant={view === 'grid' ? 'secondary' : 'ghost'}
                    size="icon"
                    className="size-7"
                    title="Dạng lưới"
                    onClick={() => onViewChange('grid')}
                >
                    <LayoutGrid className="size-4" />
                </Button>
                <Button
                    type="button"
                    variant={view === 'table' ? 'secondary' : 'ghost'}
                    size="icon"
                    className="size-7"
                    title="Dạng bảng"
                    onClick={() => onViewChange('table')}
                >
                    <Table2 className="size-4" />
                </Button>
            </div>
        </div>
    );
}
