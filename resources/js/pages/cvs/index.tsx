import { router } from '@inertiajs/react';
import type { ColumnDef } from '@tanstack/react-table';
import { Loader2, Search } from 'lucide-react';
import { useState } from 'react';
import { show as file } from '@/actions/App/Http/Controllers/CvFileController';
import { findForCv } from '@/actions/App/Http/Controllers/JobPostingController';
import { createColumn, createLinkColumn } from '@/components/tables/columns';
import { DataTableColumnHeader } from '@/components/tables/data-table-column-header';
import { Button } from '@/components/ui/button';
import IndexLayout from '@/layouts/index-layout';
import { formatDateTimePersonal } from '@/lib/personal-date';

type Cv = {
    id: number;
    name: string;
    desired_position: string | null;
    position: string | null;
    expected_salary: string | null;
    file_path: string | null;
    updated_at: string;
};

// * Searches ITviec by this CV's search keywords and has the AI score every new job against this CV (takes a while: one AI call per job).
function FindJobsButton({ cv }: { cv: Cv }) {
    const [busy, setBusy] = useState(false);

    return (
        <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || cv.position === null}
            title={
                cv.position === null
                    ? 'Nhập "Từ khoá tìm kiếm" cho CV để tìm việc'
                    : undefined
            }
            onClick={() => {
                setBusy(true);
                router.post(
                    findForCv.url(cv.id),
                    {},
                    {
                        preserveScroll: true,
                        onFinish: () => setBusy(false),
                    },
                );
            }}
        >
            {busy ? (
                <Loader2 className="size-4 motion-safe:animate-spin" />
            ) : (
                <Search className="size-4" />
            )}
            Tìm việc
        </Button>
    );
}

const columns: ColumnDef<Cv>[] = [
    createLinkColumn<Cv>({
        accessorKey: 'name',
        label: 'Tên CV',
        href: (row) => `/cvs/${row.id}`,
    }),
    createColumn<Cv>({
        accessorKey: 'desired_position',
        label: 'Vị trí ứng tuyển',
        cell: ({ row }) => row.original.desired_position ?? '—',
    }),
    createColumn<Cv>({
        accessorKey: 'position',
        label: 'Từ khoá tìm kiếm',
        cell: ({ row }) => row.original.position ?? '—',
    }),
    createColumn<Cv>({
        accessorKey: 'expected_salary',
        label: 'Lương mong muốn',
        cell: ({ row }) => row.original.expected_salary ?? '—',
    }),
    createColumn<Cv>({
        accessorKey: 'file_path',
        label: 'File CV',
        cell: ({ row }) =>
            row.original.file_path ? (
                <a
                    href={file.url(row.original.id)}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                >
                    Tải file
                </a>
            ) : (
                '—'
            ),
    }),
    {
        id: 'find_jobs',
        meta: { label: 'Tìm việc' },
        header: 'Tìm việc',
        enableSorting: false,
        cell: ({ row }) => <FindJobsButton cv={row.original} />,
    },
    createColumn<Cv>({
        accessorKey: 'updated_at',
        label: 'Cập nhật',
        cell: ({ row }) => formatDateTimePersonal(row.original.updated_at),
    }),
];

export default function CvsIndex() {
    return (
        <IndexLayout<Cv>
            title="CV"
            columns={columns}
            searchPlaceholder="Tìm theo tên, từ khoá..."
            emptyMessage="Chưa có CV nào."
        />
    );
}
