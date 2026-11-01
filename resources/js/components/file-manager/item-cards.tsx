import { Link } from '@inertiajs/react';
import { CheckSquare, Folder, Share2, Square } from 'lucide-react';
import { FileViewer } from '@/components/file-viewer';
import { cn } from '@/lib/utils';
import type { FileItem } from '@/types';
import type { BulkActions } from './actions';
import { formatDate, formatSize, thumbnailUrl } from './format';
import { ItemContextMenu, ItemMenu } from './item-menu';

type ItemCardProps = {
    item: FileItem;
    selectable: boolean;
    selected: boolean;
    bulk?: BulkActions;
    onToggleSelect: () => void;
    onMoveClick: () => void;
    onShareClick: () => void;
    registerRef: (id: number, el: HTMLElement | null) => void;
    /** * Picker mode: clicking the thumbnail toggles selection instead of opening the menu. */
    onPick?: () => void;
    picked?: boolean;
    /** * Query string kept on folder links while embedded, e.g. `&picker=1&multiple=1`. */
    pickerQuery?: string;
};

export function FolderRow({
    item,
    selectable,
    selected,
    bulk,
    onToggleSelect,
    onMoveClick,
    onShareClick,
    registerRef,
    pickerQuery,
}: ItemCardProps) {
    const href = `/file-manager?folder=${item.id}${pickerQuery ?? ''}`;

    return (
        <ItemContextMenu
            item={item}
            onMoveClick={onMoveClick}
            onShareClick={onShareClick}
            bulk={selected ? bulk : undefined}
        >
            <div
                ref={(el) => registerRef(item.id, el)}
                data-selectable-id={item.id}
                className="group flex items-center gap-2 rounded-md border border-input bg-card px-3 py-2.5 transition-colors hover:border-primary hover:bg-muted"
            >
                {selectable && (
                    <button
                        type="button"
                        onClick={onToggleSelect}
                        className="shrink-0 text-foreground"
                    >
                        {selected ? (
                            <CheckSquare className="size-4" />
                        ) : (
                            <Square className="size-4" />
                        )}
                    </button>
                )}
                <Link
                    href={href}
                    preserveState={false}
                    className="flex flex-1 items-center gap-2 overflow-hidden"
                >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">{item.name}</span>
                    {item.shared && (
                        <span title="Đã chia sẻ">
                            <Share2 className="size-3.5 shrink-0 text-muted-foreground" />
                        </span>
                    )}
                </Link>
                <ItemMenu
                    item={item}
                    onMoveClick={onMoveClick}
                    onShareClick={onShareClick}
                />
            </div>
        </ItemContextMenu>
    );
}

export function FileCard({
    item,
    selectable,
    selected,
    bulk,
    onToggleSelect,
    onMoveClick,
    onShareClick,
    registerRef,
    onPick,
    picked,
}: ItemCardProps) {
    const card = (
        <div
            ref={(el) => registerRef(item.id, el)}
            data-selectable-id={item.id}
            className={cn(
                'group relative flex flex-col gap-2 rounded-md border border-input p-2 transition-colors',
                onPick &&
                    !picked &&
                    'has-[button:active]:bg-accent has-[button:focus-visible]:border-primary has-[button:hover]:border-primary',
                picked && 'border-primary ring-2 ring-primary',
            )}
        >
            <div className="relative aspect-square overflow-hidden rounded-md bg-muted/30">
                {selectable && (
                    <button
                        type="button"
                        onClick={onToggleSelect}
                        className="absolute top-1 left-1 z-10 rounded bg-background/90 p-0.5 text-foreground shadow-sm"
                    >
                        {selected ? (
                            <CheckSquare className="size-4" />
                        ) : (
                            <Square className="size-4" />
                        )}
                    </button>
                )}
                {onPick ? (
                    <button
                        type="button"
                        onClick={onPick}
                        className="size-full cursor-pointer transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary active:opacity-75"
                    >
                        <FileViewer
                            file={{
                                url: thumbnailUrl(item),
                                name: item.original_name ?? item.name,
                                alt: item.alt ?? undefined,
                            }}
                            className="size-full"
                        />
                    </button>
                ) : (
                    <FileViewer
                        file={{
                            url: thumbnailUrl(item),
                            name: item.original_name ?? item.name,
                            alt: item.alt ?? undefined,
                        }}
                        className="size-full"
                    />
                )}
                {picked && (
                    <span className="absolute top-1 right-1 z-10 rounded-full bg-primary p-0.5 text-primary-foreground shadow-sm">
                        <CheckSquare className="size-4" />
                    </span>
                )}
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[0.65rem] text-white">
                    {formatDate(item.created_at)}
                </span>
            </div>

            {!onPick && (
                <div className="absolute top-1 right-1 rounded-full bg-background/90 shadow-sm">
                    <ItemMenu
                        item={item}
                        onMoveClick={onMoveClick}
                        onShareClick={onShareClick}
                    />
                </div>
            )}

            <div className="space-y-0.5">
                <p className="truncate text-xs font-medium" title={item.name}>
                    {item.name}
                </p>
                <p className="text-[0.7rem] text-muted-foreground">
                    {formatSize(item.size)}
                </p>
            </div>
        </div>
    );

    if (onPick) {
        return card;
    }

    return (
        <ItemContextMenu
            item={item}
            onMoveClick={onMoveClick}
            onShareClick={onShareClick}
            bulk={selected ? bulk : undefined}
        >
            {card}
        </ItemContextMenu>
    );
}
