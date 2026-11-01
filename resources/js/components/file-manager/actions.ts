import { router } from '@inertiajs/react';
import {
    Archive,
    Copy,
    Download,
    Eye,
    Image as ImageIcon,
    Move,
    PencilLine,
    Scissors,
    Share2,
    Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useConfirm } from '@/components/confirm-dialog';
import { usePrompt } from '@/components/prompt-dialog';
import type { FileItem } from '@/types';
import { thumbnailUrl } from './format';

export async function copyImageToClipboard(url: string) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        await navigator.clipboard.write([
            new ClipboardItem({ [blob.type]: blob }),
        ]);
    } catch {
        window.alert('Không thể sao chép hình ảnh này.');
    }
}

export function downloadSelection(ids: number[], defaultName: string) {
    if (ids.length === 0) {
        return;
    }

    if (ids.length === 1) {
        window.location.href = `/file-manager/${ids[0]}/download`;

        return;
    }

    window.location.href = `/file-manager/download-zip?ids=${ids.join(',')}&name=${encodeURIComponent(defaultName)}`;
}

export type ItemAction = {
    key: string;
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    show: boolean;
    destructive?: boolean;
};

export function useItemActions(
    item: FileItem,
    onMoveClick: () => void,
    onShareClick: () => void,
): ItemAction[] {
    const confirm = useConfirm();
    const prompt = usePrompt();
    const isZip = item.type === 'file' && item.extension === 'zip';
    const isImage =
        item.type === 'file' && Boolean(item.mime_type?.startsWith('image/'));

    const handleRename = async () => {
        const nextName = await prompt({
            title: item.type === 'folder' ? 'Đổi tên thư mục' : 'Đổi tên tệp',
            label:
                item.type === 'folder' ? undefined : 'Tên (dùng chung làm alt)',
            defaultValue: item.name,
            confirmLabel: 'Đổi tên',
        });

        if (nextName) {
            router.patch(`/file-manager/${item.id}`, {
                name: nextName,
                alt: nextName,
            });
        }
    };

    const handleDelete = async () => {
        const label = item.type === 'folder' ? 'thư mục' : 'tệp';
        const ok = await confirm({
            title: `Xóa ${label} "${item.name}"?`,
            description: 'Mục này sẽ được chuyển vào thùng rác.',
            confirmLabel: 'Xóa',
            destructive: true,
        });

        if (ok) {
            router.delete(`/file-manager/${item.id}`);
        }
    };

    const handleExtract = async () => {
        const ok = await confirm({
            title: `Giải nén "${item.name}"?`,
            description: 'Nội dung sẽ được giải nén vào một thư mục mới.',
            confirmLabel: 'Giải nén',
        });

        if (ok) {
            router.post(`/file-manager/${item.id}/extract`);
        }
    };

    const handleCopyImage = () => {
        const src = thumbnailUrl(item) || item.url;

        if (src) {
            copyImageToClipboard(src);
        }
    };

    return [
        {
            key: 'view',
            label: 'Xem',
            icon: Eye,
            onClick: () => window.open(item.url!, '_blank'),
            show: item.type === 'file' && Boolean(item.url),
        },
        {
            key: 'rename',
            label: 'Đổi tên',
            icon: PencilLine,
            onClick: handleRename,
            show: true,
        },
        {
            key: 'move',
            label: 'Di chuyển',
            icon: Move,
            onClick: onMoveClick,
            show: true,
        },
        {
            key: 'download',
            label: 'Tải xuống',
            icon: Download,
            onClick: () => downloadSelection([item.id], item.name),
            show: true,
        },
        {
            key: 'copy-url',
            label: 'Sao chép URL',
            icon: Copy,
            onClick: () => item.url && navigator.clipboard.writeText(item.url),
            show: item.type === 'file',
        },
        {
            key: 'copy-image',
            label: 'Sao chép hình',
            icon: ImageIcon,
            onClick: handleCopyImage,
            show: isImage,
        },
        {
            key: 'extract',
            label: 'Giải nén',
            icon: Archive,
            onClick: handleExtract,
            show: isZip,
        },
        {
            key: 'share',
            label: 'Phân quyền',
            icon: Share2,
            onClick: onShareClick,
            show:
                item.type === 'folder' && item.can_manage_permissions === true,
        },
        {
            key: 'delete',
            label: 'Xóa',
            icon: Trash2,
            onClick: handleDelete,
            show: true,
            destructive: true,
        },
    ].filter((action) => action.show);
}

export type BulkActions = {
    count: number;
    onCopy: () => void;
    onCut: () => void;
    onDownload: () => void;
    onCompress: () => void;
    onDelete: () => void;
};

export type BulkActionItem = {
    key: string;
    label: string;
    icon: LucideIcon;
    onClick: (bulk: BulkActions) => void;
    destructive?: boolean;
    separatorBefore?: boolean;
};

export const BULK_ACTION_ITEMS: BulkActionItem[] = [
    {
        key: 'copy',
        label: 'Sao chép',
        icon: Copy,
        onClick: (bulk) => bulk.onCopy(),
    },
    {
        key: 'cut',
        label: 'Cắt',
        icon: Scissors,
        onClick: (bulk) => bulk.onCut(),
    },
    {
        key: 'download',
        label: 'Tải xuống',
        icon: Download,
        onClick: (bulk) => bulk.onDownload(),
        separatorBefore: true,
    },
    {
        key: 'compress',
        label: 'Nén',
        icon: Archive,
        onClick: (bulk) => bulk.onCompress(),
    },
    {
        key: 'delete',
        label: 'Xóa',
        icon: Trash2,
        onClick: (bulk) => bulk.onDelete(),
        destructive: true,
        separatorBefore: true,
    },
];
