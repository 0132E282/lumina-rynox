import type { Column } from '@tanstack/react-table';
import {
    ArrowDown,
    ArrowUp,
    ChevronsUpDown,
    EyeOff,
    Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type FilterOption = { label: string; value: string };

type DataTableColumnHeaderProps<TData, TValue> =
    React.HTMLAttributes<HTMLDivElement> & {
        column: Column<TData, TValue>;
        title: string;
        filterOptions?: FilterOption[];
    };

export function DataTableColumnHeader<TData, TValue>({
    column,
    title,
    filterOptions,
    className,
}: DataTableColumnHeaderProps<TData, TValue>) {
    if (!column.getCanSort() && !filterOptions) {
        return <div className={cn(className)}>{title}</div>;
    }

    const sorted = column.getIsSorted();
    const selectedValues = new Set(
        (column.getFilterValue() as string[] | undefined) ?? [],
    );

    const toggleFilterValue = (value: string, checked: boolean) => {
        const next = new Set(selectedValues);

        if (checked) {
            next.add(value);
        } else {
            next.delete(value);
        }

        column.setFilterValue(next.size > 0 ? Array.from(next) : undefined);
    };

    return (
        <div className={cn('flex items-center gap-2', className)}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2 h-8 data-[state=open]:bg-accent"
                    >
                        <span>{title}</span>
                        {selectedValues.size > 0 && (
                            <Filter className="size-3.5" />
                        )}
                        {column.getCanSort() &&
                            (sorted === 'desc' ? (
                                <ArrowDown className="size-4" />
                            ) : sorted === 'asc' ? (
                                <ArrowUp className="size-4" />
                            ) : (
                                <ChevronsUpDown className="size-4" />
                            ))}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    {column.getCanSort() && (
                        <>
                            <DropdownMenuItem
                                onClick={() => column.toggleSorting(false)}
                            >
                                <ArrowUp className="size-3.5 text-muted-foreground" />
                                Tăng dần
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => column.toggleSorting(true)}
                            >
                                <ArrowDown className="size-3.5 text-muted-foreground" />
                                Giảm dần
                            </DropdownMenuItem>
                        </>
                    )}
                    {filterOptions && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>
                                Lọc theo {title.toLowerCase()}
                            </DropdownMenuLabel>
                            {filterOptions.map((option) => (
                                <DropdownMenuCheckboxItem
                                    key={option.value}
                                    checked={selectedValues.has(option.value)}
                                    onCheckedChange={(checked) =>
                                        toggleFilterValue(
                                            option.value,
                                            !!checked,
                                        )
                                    }
                                    onSelect={(event) => event.preventDefault()}
                                >
                                    {option.label}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </>
                    )}
                    {column.getCanHide() && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => column.toggleVisibility(false)}
                            >
                                <EyeOff className="size-3.5 text-muted-foreground" />
                                Ẩn cột
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
