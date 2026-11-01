import { Link } from '@inertiajs/react';
import type { ColumnDef } from '@tanstack/react-table';
import { isAxiosError } from 'axios';
import { useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { QuickAddTask } from '@/components/tasks/quick-add-task';
import { createBadgeColumn, createColumn } from '@/components/tables/columns';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import IndexLayout from '@/layouts/index-layout';
import type { IndexHandle } from '@/layouts/index-layout';
import { api } from '@/lib/api';
import { formatDate, todayIso } from '@/lib/personal-date';
import { cn } from '@/lib/utils';
import type { Task, TaskPriority, TaskStatus } from '@/types';

const PRIORITY_LABELS: Record<TaskPriority, string> = {
    low: 'Thấp',
    medium: 'Vừa',
    high: 'Cao',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
    todo: 'Chưa xong',
    done: 'Đã xong',
};

function isOverdue(task: Task): boolean {
    return (
        task.status === 'todo' &&
        task.due_date !== null &&
        task.due_date < todayIso()
    );
}

export default function TasksIndex() {
    const tableRef = useRef<IndexHandle>(null);

    const columns = useMemo<ColumnDef<Task>[]>(() => {
        const toggleStatus = async (task: Task, done: boolean) => {
            try {
                await api.put(
                    window.route('items.update', {
                        resource: 'tasks',
                        id: task.id,
                    }),
                    { status: done ? 'done' : 'todo' },
                );
                tableRef.current?.refetch();
            } catch (error) {
                toast.error(
                    isAxiosError(error) && error.response?.status === 403
                        ? 'Bạn không có quyền sửa công việc.'
                        : 'Không cập nhật được trạng thái.',
                );
            }
        };

        return [
            {
                accessorKey: 'title',
                meta: { label: 'Tiêu đề' },
                header: ({ column }) => (
                    <DataTableColumnHeader column={column} title="Tiêu đề" />
                ),
                cell: ({ row }) => {
                    const task = row.original;
                    const done = task.status === 'done';

                    return (
                        <div className="flex items-center gap-3">
                            <Checkbox
                                checked={done}
                                onCheckedChange={(value) =>
                                    toggleStatus(task, value === true)
                                }
                                aria-label={
                                    done
                                        ? `Đánh dấu "${task.title}" chưa xong`
                                        : `Đánh dấu "${task.title}" đã xong`
                                }
                            />
                            <Link
                                href={`/tasks/${task.id}`}
                                className={cn(
                                    'font-medium text-blue-600 dark:text-blue-400',
                                    done &&
                                        'text-muted-foreground line-through dark:text-muted-foreground',
                                )}
                            >
                                {task.title}
                            </Link>
                        </div>
                    );
                },
            },
            createBadgeColumn<Task, TaskPriority>({
                accessorKey: 'priority',
                label: 'Ưu tiên',
                labelMap: PRIORITY_LABELS,
                variant: {
                    low: 'outline',
                    medium: 'default',
                    high: 'destructive',
                },
                filterable: false,
            }),
            createColumn<Task>({
                accessorKey: 'due_date',
                label: 'Hạn',
                cell: ({ row }) => {
                    const task = row.original;

                    if (!task.due_date) {
                        return <span className="text-muted-foreground">-</span>;
                    }

                    return (
                        <div className="flex items-center gap-2">
                            <span
                                className={cn(
                                    task.status === 'done' &&
                                        'text-muted-foreground',
                                )}
                            >
                                {formatDate(task.due_date)}
                            </span>
                            {isOverdue(task) && (
                                <Badge variant="destructive">Quá hạn</Badge>
                            )}
                        </div>
                    );
                },
            }),
            createBadgeColumn<Task, TaskStatus>({
                accessorKey: 'status',
                label: 'Trạng thái',
                labelMap: STATUS_LABELS,
                variant: { todo: 'default', done: 'outline' },
                filterable: false,
            }),
        ];
    }, []);

    return (
        <IndexLayout<Task>
            ref={tableRef}
            title="Công việc"
            columns={columns}
            searchPlaceholder="Tìm theo tiêu đề hoặc mô tả..."
            emptyMessage="Chưa có công việc nào."
            // * 'todo' sorts after 'done' alphabetically, so descending lists open tasks first.
            defaultSort={['status:desc', 'created_at:desc']}
            renderAbove={() => (
                <QuickAddTask onAdded={() => tableRef.current?.refetch()} />
            )}
        />
    );
}
