import { Folder, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import type { TreeFolder } from '@/types';

export type FolderPickerMode = 'move' | 'copy';

const DIALOG_TITLES: Record<FolderPickerMode, string> = {
    move: 'Di chuyển đến',
    copy: 'Sao chép đến',
};

export function FolderPickerDialog({
    open,
    mode,
    excludeIds,
    onOpenChange,
    onPick,
}: {
    open: boolean;
    mode: FolderPickerMode;
    excludeIds: number[];
    onOpenChange: (open: boolean) => void;
    onPick: (targetId: number | null) => void;
}) {
    const [folders, setFolders] = useState<TreeFolder[]>([]);

    useEffect(() => {
        if (!open) {
            return;
        }

        fetch('/file-manager/tree', { headers: { Accept: 'application/json' } })
            .then((res) => res.json())
            .then(setFolders)
            .catch(() => setFolders([]));
    }, [open]);

    // * A moved folder and its descendants can't be its own target.
    const hiddenIds = useMemo(() => {
        const hidden = new Set<number>(excludeIds);
        let grew = true;

        while (grew) {
            grew = false;

            for (const folder of folders) {
                if (
                    folder.parent_id !== null &&
                    hidden.has(folder.parent_id) &&
                    !hidden.has(folder.id)
                ) {
                    hidden.add(folder.id);
                    grew = true;
                }
            }
        }

        return hidden;
    }, [folders, excludeIds]);

    const renderChildren = (parentId: number | null, depth: number) =>
        folders
            .filter(
                (folder) =>
                    folder.parent_id === parentId && !hiddenIds.has(folder.id),
            )
            .map((folder) => (
                <div key={folder.id}>
                    <button
                        type="button"
                        onClick={() => onPick(folder.id)}
                        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
                        className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-muted"
                    >
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        {folder.name}
                    </button>
                    {renderChildren(folder.id, depth + 1)}
                </div>
            ));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{DIALOG_TITLES[mode]}</DialogTitle>
                </DialogHeader>
                <div className="max-h-80 space-y-0.5 overflow-y-auto">
                    <button
                        type="button"
                        onClick={() => onPick(null)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                        Thư mục gốc
                    </button>
                    {renderChildren(null, 1)}
                </div>
            </DialogContent>
        </Dialog>
    );
}
