import { Link } from '@inertiajs/react';
import { CheckSquare, Folder, Share2, Square } from 'lucide-react';
import { FileViewer } from '@/components/file-viewer';
import type { FileItem } from '@/types';
import type { BulkActions } from './actions';
import { formatDate, formatSize, thumbnailUrl } from './format';
import { ItemContextMenu, ItemMenu } from './item-menu';

export function TableView({
    folders,
    files,
    selectable,
    selectedIds,
    bulk,
    onToggleSelect,
    onMoveClick,
    onShareClick,
    registerRef,
}: {
    folders: FileItem[];
    files: FileItem[];
    selectable: boolean;
    selectedIds: number[];
    bulk?: BulkActions;
    onToggleSelect: (id: number) => void;
    onMoveClick: (id: number) => void;
    onShareClick: (id: number) => void;
    registerRef: (id: number, el: HTMLElement | null) => void;
}) {
    const rows = [...folders, ...files];

    return (
        <div className="overflow-x-auto rounded-md border border-input">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-input bg-muted/30 text-left text-xs text-muted-foreground">
                        <th className="w-8 px-3 py-2" />
                        <th className="px-3 py-2 font-medium">Tên</th>
                        <th className="px-3 py-2 font-medium">Loại</th>
                        <th className="px-3 py-2 font-medium">Dung lượng</th>
                        <th className="px-3 py-2 font-medium">Ngày tạo</th>
                        <th className="w-10 px-3 py-2" />
                    </tr>
                </thead>
                <tbody>
                    {rows.map((item) => {
                        const selected = selectedIds.includes(item.id);
                        const isFolder = item.type === 'folder';

                        return (
                            <ItemContextMenu
                                key={item.id}
                                item={item}
                                onMoveClick={() => onMoveClick(item.id)}
                                onShareClick={() => onShareClick(item.id)}
                                bulk={selected ? bulk : undefined}
                            >
                                <tr
                                    ref={(el) => registerRef(item.id, el)}
                                    data-selectable-id={item.id}
                                    className="border-b border-input last:border-0 hover:bg-muted/40"
                                >
                                    <td className="px-3 py-2">
                                        {selectable && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    onToggleSelect(item.id)
                                                }
                                                className="text-foreground"
                                            >
                                                {selected ? (
                                                    <CheckSquare className="size-4" />
                                                ) : (
                                                    <Square className="size-4" />
                                                )}
                                            </button>
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        {isFolder ? (
                                            <Link
                                                href={`/file-manager?folder=${item.id}`}
                                                preserveState={false}
                                                className="flex items-center gap-2 hover:text-foreground"
                                            >
                                                <Folder className="size-4 shrink-0 text-muted-foreground" />
                                                <span className="truncate">
                                                    {item.name}
                                                </span>
                                                {item.shared && (
                                                    <span title="Đã chia sẻ">
                                                        <Share2 className="size-3.5 shrink-0 text-muted-foreground" />
                                                    </span>
                                                )}
                                            </Link>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <div className="size-8 shrink-0 overflow-hidden rounded bg-muted/30">
                                                    <FileViewer
                                                        file={{
                                                            url: thumbnailUrl(
                                                                item,
                                                            ),
                                                            name:
                                                                item.original_name ??
                                                                item.name,
                                                            alt:
                                                                item.alt ??
                                                                undefined,
                                                        }}
                                                        className="size-full"
                                                    />
                                                </div>
                                                <span
                                                    className="truncate"
                                                    title={item.name}
                                                >
                                                    {item.name}
                                                </span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                        {isFolder
                                            ? 'Thư mục'
                                            : (item.extension ?? '—')}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                        {isFolder ? '—' : formatSize(item.size)}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                        {formatDate(item.created_at)}
                                    </td>
                                    <td className="px-3 py-2">
                                        <ItemMenu
                                            item={item}
                                            onMoveClick={() =>
                                                onMoveClick(item.id)
                                            }
                                            onShareClick={() =>
                                                onShareClick(item.id)
                                            }
                                        />
                                    </td>
                                </tr>
                            </ItemContextMenu>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
