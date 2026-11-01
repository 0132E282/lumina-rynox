import { ChevronRight, Folder } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

type TreeFile = { id: number; parent_id: number | null; name: string };

type TreeNode = TreeFile & { children: TreeNode[] };

const ROOT_NODE_ID = 0;

function buildTree(files: TreeFile[] | null | undefined): TreeNode {
    const byParent = new Map<number | null, TreeFile[]>();

    for (const file of files ?? []) {
        const list = byParent.get(file.parent_id) ?? [];
        list.push(file);
        byParent.set(file.parent_id, list);
    }

    const toNode = (file: TreeFile): TreeNode => ({
        ...file,
        children: (byParent.get(file.id) ?? []).map(toNode),
    });

    return {
        id: ROOT_NODE_ID,
        parent_id: null,
        name: 'Thư mục gốc (Root)',
        children: (byParent.get(null) ?? []).map(toNode),
    };
}

function TreeRow({
    node,
    depth,
    onManage,
}: {
    node: TreeNode;
    depth: number;
    onManage: (id: number, name: string) => void;
}) {
    const [expanded, setExpanded] = useState(depth === 0);
    const hasChildren = node.children.length > 0;

    return (
        <div>
            <div className="flex items-center justify-between gap-2 border-b px-2 py-2 last:border-b-0 hover:bg-muted/50">
                <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
                    style={{ paddingLeft: depth * 20 }}
                    onClick={() => hasChildren && setExpanded((prev) => !prev)}
                    disabled={!hasChildren}
                >
                    {hasChildren ? (
                        <ChevronRight
                            className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
                        />
                    ) : (
                        <span className="size-4 shrink-0" />
                    )}
                    <Folder className="size-4 shrink-0 text-blue-500" />
                    <span className="truncate text-sm">{node.name}</span>
                </button>

                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onManage(node.id, node.name)}
                >
                    Phân quyền
                </Button>
            </div>

            {expanded && hasChildren && (
                <div>
                    {node.children.map((child) => (
                        <TreeRow
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            onManage={onManage}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function FolderPermissionTree({
    files,
    onManage,
}: {
    files: TreeFile[];
    onManage: (id: number, name: string) => void;
}) {
    const root = useMemo(() => buildTree(files), [files]);

    return (
        <div className="rounded-md border">
            <TreeRow node={root} depth={0} onManage={onManage} />
        </div>
    );
}
