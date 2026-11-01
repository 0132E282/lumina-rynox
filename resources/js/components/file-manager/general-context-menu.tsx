import { FolderPlus, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { BulkActions } from './actions';
import { BulkMenuItems } from './item-menu';

export function GeneralContextMenu({
    bulk,
    onNewFolder,
    onUploadClick,
    children,
}: {
    bulk?: BulkActions;
    onNewFolder: () => void;
    onUploadClick: () => void;
    children: ReactNode;
}) {
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent>
                {bulk ? (
                    <BulkMenuItems bulk={bulk} />
                ) : (
                    <>
                        <ContextMenuItem onClick={onNewFolder}>
                            <FolderPlus className="size-4" />
                            Thư mục mới
                        </ContextMenuItem>
                        <ContextMenuItem onClick={onUploadClick}>
                            <Upload className="size-4" />
                            Tải lên
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
