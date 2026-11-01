import { Info, MoreHorizontal } from 'lucide-react';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { RowActionsMenu } from '@/components/tables/row-actions-menu';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { FileItem } from '@/types';
import { BULK_ACTION_ITEMS, useItemActions } from './actions';
import type { BulkActions } from './actions';

export function ItemMenu({
    item,
    onMoveClick,
    onShareClick,
}: {
    item: FileItem;
    onMoveClick: () => void;
    onShareClick: () => void;
}) {
    const actions = useItemActions(item, onMoveClick, onShareClick);

    return (
        <RowActionsMenu
            trigger={
                <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-full p-1 text-muted-foreground hover:text-foreground"
                >
                    <MoreHorizontal className="size-3.5" />
                </button>
            }
            items={actions.map((action) => ({
                label: action.label,
                icon: action.icon,
                destructive: action.destructive,
                onSelect: action.onClick,
            }))}
        />
    );
}

export function BulkMenuItems({ bulk }: { bulk: BulkActions }) {
    return (
        <>
            <ContextMenuLabel className="flex items-center gap-2 text-muted-foreground">
                <Info className="size-4" />
                {bulk.count} mục đã chọn
            </ContextMenuLabel>
            {BULK_ACTION_ITEMS.map((action) => (
                <Fragment key={action.key}>
                    {action.separatorBefore && <ContextMenuSeparator />}
                    <ContextMenuItem
                        onClick={() => action.onClick(bulk)}
                        variant={action.destructive ? 'destructive' : 'default'}
                    >
                        <action.icon className="size-4" />
                        {action.label}
                    </ContextMenuItem>
                </Fragment>
            ))}
        </>
    );
}

export function ItemContextMenu({
    item,
    onMoveClick,
    onShareClick,
    bulk,
    children,
}: {
    item: FileItem;
    onMoveClick: () => void;
    onShareClick: () => void;
    bulk?: BulkActions;
    children: ReactNode;
}) {
    const actions = useItemActions(item, onMoveClick, onShareClick);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent>
                {bulk ? (
                    <BulkMenuItems bulk={bulk} />
                ) : (
                    actions.map((action) => (
                        <ContextMenuItem
                            key={action.key}
                            onClick={action.onClick}
                            variant={
                                action.destructive ? 'destructive' : 'default'
                            }
                        >
                            <action.icon className="size-4" />
                            {action.label}
                        </ContextMenuItem>
                    ))
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
