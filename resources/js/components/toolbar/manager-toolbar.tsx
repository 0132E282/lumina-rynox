import { Link } from '@inertiajs/react';
import { DatabaseZap, FolderPlus, Trash2 } from 'lucide-react';
import { formatSize } from '@/components/file-manager/format';
import { UploadButton } from '@/components/file-manager/upload';
import { Button } from '@/components/ui/button';

export function FileManagerToolbar({
    folderId,
    cacheSize,
    onClearCache,
    onNewFolder,
}: {
    folderId: number | null;
    cacheSize: number;
    onClearCache: () => void;
    onNewFolder: () => void;
}) {
    return (
        <div className="flex items-center justify-end gap-2">
            <Button
                type="button"
                variant="outline"
                onClick={onClearCache}
                title="Xóa cache ảnh"
            >
                <DatabaseZap className="size-4" />
                Cache: {formatSize(cacheSize)}
            </Button>
            <Link href="/file-manager/trash">
                <Button type="button" variant="outline">
                    <Trash2 className="size-4" />
                    Thùng rác
                </Button>
            </Link>
            <Button type="button" variant="outline" onClick={onNewFolder}>
                <FolderPlus className="size-4" />
                Thư mục mới
            </Button>
            <UploadButton folderId={folderId} />
        </div>
    );
}
