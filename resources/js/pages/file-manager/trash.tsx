import { Head, Link, router } from '@inertiajs/react';
import { ArrowLeft, Folder, RotateCcw, Trash2 } from 'lucide-react';
import { formatSize } from '@/components/file-manager/format';
import { FileManagerPagination } from '@/components/file-manager/pagination';
import { FileViewer } from '@/components/file-viewer';
import Heading from '@/components/heading';
import { Button } from '@/components/ui/button';
import type { FileItem, Paginated } from '@/types';

function TrashItem({ item }: { item: FileItem }) {
    const handleRestore = () => {
        router.post(`/file-manager/${item.id}/restore`);
    };

    const handleForceDelete = () => {
        const label = item.type === 'folder' ? 'thư mục' : 'tệp';

        if (
            window.confirm(
                `Xóa vĩnh viễn ${label} "${item.name}"? Hành động này không thể hoàn tác.`,
            )
        ) {
            router.delete(`/file-manager/${item.id}/force`);
        }
    };

    return (
        <div className="flex flex-col gap-2 rounded-md border border-input p-2">
            <div className="relative aspect-square overflow-hidden rounded-md bg-muted/30">
                {item.type === 'folder' ? (
                    <FileViewer file={null} isFolder className="size-full" />
                ) : (
                    <FileViewer
                        file={{
                            url: item.url ?? '',
                            name: item.original_name ?? item.name,
                            alt: item.alt ?? undefined,
                        }}
                        className="size-full"
                    />
                )}
            </div>

            <p className="truncate text-xs font-medium" title={item.name}>
                {item.name}
            </p>
            <p className="text-[0.7rem] text-muted-foreground">
                {item.type === 'folder' ? 'Thư mục' : formatSize(item.size)}
            </p>

            <div className="flex gap-1">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={handleRestore}
                >
                    <RotateCcw className="size-3.5" />
                    Khôi phục
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={handleForceDelete}
                >
                    <Trash2 className="size-3.5" />
                </Button>
            </div>
        </div>
    );
}

export default function FileManagerTrash({
    files,
}: {
    files: Paginated<FileItem>;
}) {
    return (
        <div className="flex flex-1 flex-col gap-6 p-4">
            <Head title="Thùng rác - File Manager" />

            <div className="flex items-center justify-between">
                <Heading
                    title="Thùng rác"
                    description="Các tệp và thư mục đã xóa, có thể khôi phục hoặc xóa vĩnh viễn"
                />
                <Link href="/file-manager">
                    <Button type="button" variant="outline">
                        <ArrowLeft className="size-4" />
                        Quay lại File Manager
                    </Button>
                </Link>
            </div>

            {files.data.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-16 text-muted-foreground">
                    <Folder className="size-6" />
                    <p className="text-sm">Thùng rác trống</p>
                </div>
            ) : (
                <div className="grid grid-cols-5 gap-3">
                    {files.data.map((item) => (
                        <TrashItem key={item.id} item={item} />
                    ))}
                </div>
            )}

            <FileManagerPagination files={files} />
        </div>
    );
}
