import { Check, ChevronDown, ChevronRight, Copy, File, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
    file as fileRoute,
    tree as treeRoute,
} from '@/actions/App/Http/Controllers/AiChatController';
import { Button } from '@/components/ui/button';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import type { AiChatProposal } from '@/types';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// * Monaco is heavy: it loads only when a file is opened.
const MonacoCode = lazy(() => import('@/components/ai-chat/monaco-code'));
const MonacoDiff = lazy(() => import('@/components/ai-chat/monaco-diff'));

const CHANGE_BADGES = {
    update: {
        letter: 'M',
        label: 'đã sửa',
        className: 'text-amber-600 dark:text-amber-400',
    },
    create: {
        letter: 'A',
        label: 'thêm mới',
        className: 'text-green-600 dark:text-green-400',
    },
} as const;

type TreeNode = {
    name: string;
    path: string;
    children: TreeNode[] | null;
};

function errorText(caught: unknown, fallback: string): string {
    return (
        (caught as { response?: { data?: { message?: string } } }).response
            ?.data?.message ?? fallback
    );
}

// * Folders first, then files, each alphabetically.
function buildTree(paths: string[]): TreeNode[] {
    const root: TreeNode = { name: '', path: '', children: [] };

    for (const path of paths) {
        let node = root;
        const parts = path.split('/');

        parts.forEach((name, index) => {
            const isFile = index === parts.length - 1;
            const nodePath = parts.slice(0, index + 1).join('/');
            let child = node.children?.find((item) => item.name === name);

            if (!child) {
                child = { name, path: nodePath, children: isFile ? null : [] };
                node.children?.push(child);
            }

            node = child;
        });
    }

    const sort = (nodes: TreeNode[]) => {
        nodes.sort(
            (a, b) =>
                Number(b.children !== null) - Number(a.children !== null) ||
                a.name.localeCompare(b.name),
        );
        nodes.forEach((node) => node.children && sort(node.children));
    };

    sort(root.children ?? []);

    return root.children ?? [];
}

function TreeItems({
    nodes,
    depth,
    openDirs,
    onToggle,
    selected,
    onSelect,
    changed,
}: {
    nodes: TreeNode[];
    depth: number;
    openDirs: Set<string>;
    onToggle: (path: string) => void;
    selected: string | null;
    onSelect: (path: string) => void;
    changed: Map<string, AiChatProposal['action']>;
}) {
    return (
        <ul role={depth === 0 ? 'tree' : 'group'}>
            {nodes.map((node) => {
                const isDir = node.children !== null;
                const isOpen = openDirs.has(node.path);

                return (
                    <li
                        key={node.path}
                        role="treeitem"
                        aria-expanded={isDir ? isOpen : undefined}
                        aria-selected={node.path === selected}
                    >
                        <button
                            type="button"
                            onClick={() =>
                                isDir
                                    ? onToggle(node.path)
                                    : onSelect(node.path)
                            }
                            style={{ paddingLeft: `${depth * 12 + 8}px` }}
                            className={cn(
                                'flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                node.path === selected &&
                                    'bg-accent text-accent-foreground',
                            )}
                        >
                            {isDir ? (
                                isOpen ? (
                                    <ChevronDown
                                        aria-hidden="true"
                                        className="size-3.5 shrink-0"
                                    />
                                ) : (
                                    <ChevronRight
                                        aria-hidden="true"
                                        className="size-3.5 shrink-0"
                                    />
                                )
                            ) : (
                                <File
                                    aria-hidden="true"
                                    className="size-3.5 shrink-0 text-muted-foreground"
                                />
                            )}
                            <span
                                className={cn(
                                    'truncate',
                                    changed.has(node.path) &&
                                        CHANGE_BADGES[changed.get(node.path)!]
                                            .className,
                                )}
                            >
                                {node.name}
                            </span>
                            {changed.has(node.path) && (
                                <span
                                    title={`Đã thay đổi (${CHANGE_BADGES[changed.get(node.path)!].label})`}
                                    className={cn(
                                        'ml-auto shrink-0 text-xs font-medium',
                                        CHANGE_BADGES[changed.get(node.path)!]
                                            .className,
                                    )}
                                >
                                    {
                                        CHANGE_BADGES[changed.get(node.path)!]
                                            .letter
                                    }
                                </span>
                            )}
                        </button>
                        {isDir && isOpen && node.children && (
                            <TreeItems
                                nodes={node.children}
                                depth={depth + 1}
                                openDirs={openDirs}
                                onToggle={onToggle}
                                selected={selected}
                                onSelect={onSelect}
                                changed={changed}
                            />
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/** * Read-only code viewer of the selected GitHub repo: file tree on the right, the open file with line numbers on the left. */
export function CodeViewer({
    repo,
    onClose,
    onMention,
    onReview,
    changes,
}: {
    repo: string;
    onClose: () => void;
    /** * Puts the file's path into the chat draft so the AI reads it. */
    onMention: (path: string) => void;
    /** * Like onMention, and also fills a Vietnamese review prompt into the draft (never sends it). */
    onReview: (path: string) => void;
    /** * Files the AI changed in this conversation (shown with M/A marks and a diff). */
    changes: AiChatProposal[];
}) {
    const { copied: pathCopied, copy: copyPath } = useCopyToClipboard();
    const fileWidth = useResizableWidth('ai-chat.width.file', 704, 320, 1000);
    const treeWidth = useResizableWidth('ai-chat.width.tree', 256, 180, 480);
    const localRoot = repo.startsWith('local:') ? repo.slice(6) : null;
    const sourceName = localRoot ? `Máy local · ${localRoot}` : repo;
    const [paths, setPaths] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<string | null>(null);
    const [content, setContent] = useState<string | null>(null);
    // * For a changed file: the AI's version, shown as a diff against `content` (the file as it is on the default branch).
    const [proposed, setProposed] = useState<string | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        // * "local:{id}" is a folder of this machine (read-only here); anything else is a GitHub repo.
        const request = localRoot
            ? api.get<{ paths: string[] }>('/ai-chat/local/tree', {
                  params: { root: localRoot },
              })
            : api.get<{ paths: string[] }>(treeRoute.url({ query: { repo } }));

        request
            .then(({ data }) => !cancelled && setPaths(data.paths))
            .catch((caught) => {
                if (!cancelled) {
                    setPaths([]);
                    setError(errorText(caught, 'Không tải được cây thư mục.'));
                }
            });

        return () => {
            cancelled = true;
        };
    }, [repo, localRoot]);

    const changed = useMemo(
        () =>
            new Map(
                changes
                    .filter(
                        (change) =>
                            change.repo === repo &&
                            change.status !== 'rejected',
                    )
                    .map((change) => [change.path, change] as const),
            ),
        [changes, repo],
    );
    const changedActions = useMemo(
        () =>
            new Map(
                [...changed].map(([path, change]) => [path, change.action]),
            ),
        [changed],
    );
    // * New files the AI proposes are not in the repo's tree yet: add them so they show up too.
    const allPaths = useMemo(
        () => [
            ...(paths ?? []),
            ...[...changed.keys()].filter(
                (path) => !(paths ?? []).includes(path),
            ),
        ],
        [paths, changed],
    );

    const query = filter.trim().toLowerCase();
    const tree = useMemo(
        () =>
            buildTree(
                allPaths.filter((path) => path.toLowerCase().includes(query)),
            ),
        [allPaths, query],
    );
    // * While filtering, every folder with a match is shown open.
    const effectiveOpen = useMemo(() => {
        if (query === '') {
            return openDirs;
        }

        const all = new Set<string>();

        allPaths.forEach((path) => {
            const parts = path.split('/');

            parts
                .slice(0, -1)
                .forEach((_, index) =>
                    all.add(parts.slice(0, index + 1).join('/')),
                );
        });

        return all;
    }, [openDirs, allPaths, query]);

    const openFile = async (path: string) => {
        const change = changed.get(path);

        setSelected(path);
        setContent(null);
        setProposed(change?.content ?? null);
        setFileError(null);

        // * A file the AI is creating has no current version to load.
        if (change?.action === 'create') {
            setContent('');

            return;
        }

        try {
            const { data } = await api.get<{ content: string }>(
                localRoot
                    ? '/ai-chat/local/file'
                    : fileRoute.url({ query: { repo, path } }),
                localRoot ? { params: { root: localRoot, path } } : undefined,
            );

            setContent(data.content);
        } catch (caught) {
            setFileError(errorText(caught, 'Không mở được tệp.'));
        }
    };

    const toggleDir = (path: string) =>
        setOpenDirs((current) => {
            const next = new Set(current);

            if (!next.delete(path)) {
                next.add(path);
            }

            return next;
        });

    return (
        <>
            {/* * Open file: its own column between the chat and the tree. */}
            {selected !== null && (
                <section
                    aria-label="Nội dung tệp"
                    style={{ width: fileWidth.width }}
                    className="relative hidden min-h-0 max-w-[60%] shrink-0 flex-col border-l lg:flex"
                >
                    <ResizeHandle
                        label="Đổi độ rộng khung xem tệp"
                        {...fileWidth.handleProps}
                    />
                    <div className="flex h-12 items-center justify-between gap-2 border-b px-3 text-xs text-muted-foreground">
                        <span className="truncate" dir="rtl">
                            <bdi>
                                {selected.split('/').slice(0, -1).join(' / ')}
                                {selected.includes('/') && ' / '}
                                <span className="font-medium text-foreground">
                                    {selected.split('/').pop()}
                                </span>
                            </bdi>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Sao chép đường dẫn tệp"
                                title="Sao chép đường dẫn tệp"
                                onClick={() => copyPath(selected)}
                                className="size-7"
                            >
                                {pathCopied ? (
                                    <Check aria-hidden="true" />
                                ) : (
                                    <Copy aria-hidden="true" />
                                )}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7"
                                onClick={() => onMention(selected)}
                            >
                                Nhờ AI đọc tệp này
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7"
                                onClick={() => onReview(selected)}
                            >
                                Review
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Đóng tệp"
                                onClick={() => setSelected(null)}
                                className="size-7"
                            >
                                <X aria-hidden="true" />
                            </Button>
                        </span>
                    </div>
                    {fileError !== null ? (
                        <p
                            role="alert"
                            className="m-4 text-sm text-destructive"
                        >
                            {fileError}
                        </p>
                    ) : content === null ? (
                        <p className="m-4 text-sm text-muted-foreground">
                            Đang tải...
                        </p>
                    ) : (
                        <div className="min-h-0 flex-1">
                            <Suspense
                                fallback={
                                    <p className="m-4 text-sm text-muted-foreground">
                                        Đang tải...
                                    </p>
                                }
                            >
                                {proposed !== null ? (
                                    <MonacoDiff
                                        path={selected}
                                        original={content}
                                        modified={proposed}
                                    />
                                ) : (
                                    <MonacoCode
                                        path={selected}
                                        value={content}
                                    />
                                )}
                            </Suspense>
                        </div>
                    )}
                </section>
            )}
            {/* * File tree: the far-right column, like an editor's explorer. */}
            <aside
                aria-label={`Cây thư mục ${sourceName}`}
                style={{ width: treeWidth.width }}
                className="relative hidden min-h-0 max-w-[40%] shrink-0 flex-col border-l md:flex"
            >
                <ResizeHandle
                    label="Đổi độ rộng cây thư mục"
                    {...treeWidth.handleProps}
                />
                <header className="flex h-12 items-center justify-between gap-2 border-b px-3">
                    <span className="truncate text-sm font-medium">
                        {sourceName}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Đóng trình xem code"
                        onClick={onClose}
                        className="size-8 text-muted-foreground"
                    >
                        <X aria-hidden="true" />
                    </Button>
                </header>
                <nav
                    aria-label="Cây thư mục"
                    className="flex min-h-0 flex-1 flex-col gap-2 p-2"
                >
                    <Input
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                        aria-label="Lọc tệp"
                        placeholder="Lọc tệp..."
                        className="h-8"
                    />
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {paths === null ? (
                            <p className="px-2 text-sm text-muted-foreground">
                                Đang tải...
                            </p>
                        ) : error !== null ? (
                            <p
                                role="alert"
                                className="px-2 text-sm text-destructive"
                            >
                                {error}
                            </p>
                        ) : tree.length === 0 ? (
                            <p className="px-2 text-sm text-muted-foreground">
                                Không có tệp nào.
                            </p>
                        ) : (
                            <TreeItems
                                nodes={tree}
                                depth={0}
                                openDirs={effectiveOpen}
                                onToggle={toggleDir}
                                selected={selected}
                                onSelect={(path) => void openFile(path)}
                                changed={changedActions}
                            />
                        )}
                    </div>
                </nav>
            </aside>
        </>
    );
}
