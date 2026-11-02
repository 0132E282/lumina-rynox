import {
    Check,
    ChevronDown,
    ChevronRight,
    ChevronsDownUp,
    Code2,
    Copy,
    Eye,
    Save,
    X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
    file as fileRoute,
    tree as treeRoute,
} from '@/actions/App/Http/Controllers/AiChatController';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileIcon } from '@/components/ai-chat/file-icon';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { cachedRequest } from '@/lib/ai-chat-cache';
import { diffSides, reconstructOriginal } from '@/lib/proposal-original';
import { requestErrorMessage } from '@/lib/ai-error';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import type { AiChatProposal } from '@/types';
import { Input } from '@/components/ui/input';
import { LoadingRows } from '@/components/ai-chat/loading-rows';
import {
    LocalChanges,
    useLocalChanges,
} from '@/components/ai-chat/local-changes';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

const errorText = requestErrorMessage;

// * How often an open local file is checked against the disk (the local file reads share a per-minute budget).
const LIVE_REFRESH_MS = 8000;

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
    changedDirs,
}: {
    nodes: TreeNode[];
    depth: number;
    openDirs: Set<string>;
    onToggle: (path: string) => void;
    selected: string | null;
    onSelect: (path: string) => void;
    changed: Map<string, AiChatProposal['action']>;
    changedDirs: Set<string>;
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
                                <span className="size-3.5 shrink-0" />
                            )}
                            <FileIcon
                                name={node.name}
                                dir={isDir}
                                open={isOpen}
                            />
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
                            {isDir && changedDirs.has(node.path) && (
                                <span
                                    role="img"
                                    aria-label="Có tệp đã thay đổi"
                                    title="Có tệp đã thay đổi"
                                    className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500"
                                />
                            )}
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
                                changedDirs={changedDirs}
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
    repos,
    onViewRepo,
    changes,
    openRequest = null,
    onAsk,
}: {
    /** * The project whose files are shown. */
    repo: string;
    /** * Every project picked for the chat; with more than one the header offers a dropdown to switch. */
    repos: string[];
    onViewRepo: (repo: string) => void;
    /** * Files the AI changed in this conversation (shown with M/A marks and a diff). */
    changes: AiChatProposal[];
    /** * A file to open right away (clicked in an edit proposal of the chat). */
    openRequest?: { repo: string; path: string; id: number } | null;
    /** * The person picked lines and chose "Chat với AI": the chat takes them as a reference. */
    onAsk?: (reference: {
        path: string;
        startLine: number;
        endLine: number;
        text: string;
    }) => void;
}) {
    const { copied: pathCopied, copy: copyPath } = useCopyToClipboard();
    const fileWidth = useResizableWidth(
        'ai-chat.width.file',
        704,
        320,
        window.innerWidth,
    );
    const treeWidth = useResizableWidth(
        'ai-chat.width.tree',
        256,
        180,
        window.innerWidth,
    );
    const localRoot = repo.startsWith('local:') ? repo.slice(6) : null;
    const sourceName = localRoot ? `Máy local · ${localRoot}` : repo;
    const [paths, setPaths] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<string | null>(null);
    const [content, setContent] = useState<string | null>(null);
    // * The column left of the tree shows the open file, or (local projects) every file that differs from git HEAD.
    const [view, setView] = useState<'files' | 'changes'>('files');
    // * The person's unsaved edit of the open local file (null = none).
    const [draft, setDraft] = useState<string | null>(null);
    // * The open local file as it is in git HEAD (null: not tracked, or no git): the editor marks the lines that differ.
    const [baseline, setBaseline] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    // * For a changed file: the AI's version, shown as a diff against `content` (the file as it is on the default branch).
    const [proposed, setProposed] = useState<string | null>(null);
    // * For an applied local edit: the file before the edit, rebuilt from the stored diff (the diff's left side).
    const [base, setBase] = useState<string | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);
    // * An image file arrives as a data URL and is shown as a picture instead of text.
    const [image, setImage] = useState<string | null>(null);
    // * A markdown file can be read rendered instead of as code (resets when another file opens).
    const [preview, setPreview] = useState(false);
    const isMarkdown = /\.(md|markdown)$/i.test(selected ?? '');

    useEffect(() => setPreview(false), [selected]);

    useEffect(() => {
        let cancelled = false;

        // * "local:{id}" is a folder of this machine (read-only here); anything else is a GitHub repo.
        // * The tree of a repo is fetched once and kept a few minutes: closing and reopening the viewer, or switching tabs, does not refetch it.
        const request = cachedRequest(
            `tree.${repo}`,
            localRoot ? 30_000 : 5 * 60 * 1000,
            () =>
                (localRoot
                    ? api.get<{ paths: string[] }>('/ai-chat/local/tree', {
                          params: { root: localRoot },
                      })
                    : api.get<{ paths: string[] }>(
                          treeRoute.url({ query: { repo } }),
                      )
                ).then(({ data }) => data.paths),
        );

        request
            .then((rows) => !cancelled && setPaths(rows))
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
    const localChanges = useLocalChanges(localRoot);
    // * What the tree marks: the AI's edits plus (local projects) every file git sees as modified or new.
    const changedActions = useMemo(() => {
        const marks = new Map<string, AiChatProposal['action']>();

        localChanges.files?.forEach((file) => {
            if (file.status !== 'D') {
                marks.set(file.path, file.status === 'A' ? 'create' : 'update');
            }
        });
        changed.forEach((change, path) => marks.set(path, change.action));

        return marks;
    }, [changed, localChanges.files]);
    // * Every folder that holds a marked file shows a dot, so a change is visible even in a closed folder.
    const changedDirs = useMemo(() => {
        const dirs = new Set<string>();

        changedActions.forEach((_, path) => {
            const parts = path.split('/');

            parts
                .slice(0, -1)
                .forEach((_part, index) =>
                    dirs.add(parts.slice(0, index + 1).join('/')),
                );
        });

        return dirs;
    }, [changedActions]);
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

    // * An open local file follows the disk: every few seconds (tab visible, not while a diff is shown) it is read again and replaced only when its text changed.
    const contentRef = useRef<string | null>(null);

    const draftRef = useRef<string | null>(null);

    useEffect(() => {
        contentRef.current = content;
    }, [content]);

    useEffect(() => {
        draftRef.current = draft;
    }, [draft]);

    useEffect(() => {
        if (localRoot === null || selected === null || proposed !== null) {
            return;
        }

        let cancelled = false;
        const timer = window.setInterval(() => {
            // * An unsaved edit is never replaced by the disk's text.
            if (
                document.hidden ||
                contentRef.current === null ||
                draftRef.current !== null
            ) {
                return;
            }

            api.get<{ content?: string; image?: string }>(
                '/ai-chat/local/file',
                { params: { root: localRoot, path: selected } },
            )
                .then(({ data }) => {
                    if (
                        !cancelled &&
                        data.content !== undefined &&
                        data.content !== contentRef.current
                    ) {
                        setContent(data.content);
                    }
                })
                .catch(() => undefined);
        }, LIVE_REFRESH_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [localRoot, selected, proposed]);

    // * Status of the AI's change to the open file when it was loaded: applying it later reloads the file.
    const loadedStatus = useRef<string | undefined>(undefined);
    const selectedStatus =
        selected === null ? undefined : changed.get(selected)?.status;

    useEffect(() => {
        if (
            selected !== null &&
            localRoot !== null &&
            selectedStatus === 'applied' &&
            loadedStatus.current !== 'applied'
        ) {
            void openFile(selected);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStatus]);

    // * Opens the file a proposal pointed at, once per request, as soon as the project's tree is known.
    const handledRequest = useRef<number | null>(null);

    useEffect(() => {
        if (
            openRequest !== null &&
            openRequest.repo === repo &&
            paths !== null &&
            handledRequest.current !== openRequest.id
        ) {
            handledRequest.current = openRequest.id;
            void openFile(openRequest.path);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openRequest, paths, repo]);

    const openFile = async (path: string) => {
        const change = changed.get(path);

        // * A local edit that is applied is already in the file: show the file itself, not a diff against itself.
        const applied = localRoot !== null && change?.status === 'applied';

        loadedStatus.current = change?.status;
        setView('files');
        setSelected(path);
        setContent(null);
        setDraft(null);
        setBaseline(null);
        setSaveError(null);
        setImage(null);
        setProposed(applied ? null : (change?.content ?? null));
        setBase(null);
        setFileError(null);

        // * A file the AI is creating has no current version to load.
        if (change?.action === 'create' && !applied) {
            setContent('');

            return;
        }

        try {
            // * A file read stays cached for a minute so clicking back and forth does not burn the per-minute budget (a local file may change, so it is not cached).
            const load = () =>
                api
                    .get<{ content?: string; image?: string }>(
                        localRoot
                            ? '/ai-chat/local/file'
                            : fileRoute.url({ query: { repo, path } }),
                        localRoot
                            ? { params: { root: localRoot, path } }
                            : undefined,
                    )
                    .then(({ data }) => data);

            const file = localRoot
                ? await load()
                : await cachedRequest(`file.${repo}.${path}`, 60_000, load);

            setImage(file.image ?? null);
            setContent(file.content ?? '');

            if (localRoot && file.content !== undefined) {
                api.get<{ content: string; tracked: boolean }>(
                    '/ai-chat/local/head',
                    { params: { root: localRoot, path } },
                )
                    .then(({ data }) =>
                        setBaseline(data.tracked ? data.content : null),
                    )
                    .catch(() => setBaseline(null));
            }

            // * An applied local edit shows what changed: the file now against the file as it was (rebuilt from the stored diff).
            if (applied && change?.diff && file.content !== undefined) {
                const before = reconstructOriginal(file.content, change.diff);

                if (before !== null) {
                    setBase(before);
                    setProposed(file.content);
                } else {
                    // * The file changed since the edit: show the stored change on its own.
                    const sides = diffSides(change.diff);

                    setBase(sides.before);
                    setProposed(sides.after);
                }
            }
        } catch (caught) {
            setFileError(errorText(caught, 'Không mở được tệp.'));
        }
    };

    const save = async () => {
        if (
            localRoot === null ||
            selected === null ||
            content === null ||
            draft === null ||
            saving
        ) {
            return;
        }

        setSaving(true);
        setSaveError(null);

        try {
            await api.put('/ai-chat/local/file', {
                root: localRoot,
                path: selected,
                content: draft,
                original: content,
            });
            setContent(draft);
            setDraft(null);
        } catch (caught) {
            setSaveError(errorText(caught, 'Không lưu được tệp.'));
        } finally {
            setSaving(false);
        }
    };

    // * Only a plain local text file can be edited; GitHub files and AI proposals stay read-only.
    const editable = localRoot !== null && proposed === null && image === null;

    const showChanges = localRoot !== null && view === 'changes';

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
            {showChanges && (
                <section
                    aria-label="Thay đổi so với git"
                    style={{ width: fileWidth.width }}
                    className="relative hidden min-h-0 max-w-full min-w-[18rem] shrink flex-col border-l lg:flex"
                >
                    <ResizeHandle
                        label="Đổi độ rộng khung thay đổi"
                        {...fileWidth.handleProps}
                    />
                    <div className="flex h-12 items-center border-b px-3 text-sm font-medium">
                        Thay đổi
                    </div>
                    <LocalChanges
                        root={localRoot}
                        list={localChanges}
                        onOpenFile={(path) => void openFile(path)}
                    />
                </section>
            )}
            {selected !== null && !showChanges && (
                <section
                    aria-label="Nội dung tệp"
                    style={{ width: fileWidth.width }}
                    className="relative hidden min-h-0 max-w-full min-w-[18rem] shrink flex-col border-l lg:flex"
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
                            {isMarkdown &&
                                content !== null &&
                                proposed === null && (
                                    <Tabs
                                        value={preview ? 'view' : 'code'}
                                        onValueChange={(value) =>
                                            setPreview(value === 'view')
                                        }
                                    >
                                        <TabsList className="h-7">
                                            <TabsTrigger
                                                value="view"
                                                className="gap-1 px-2.5 text-xs"
                                            >
                                                <Eye aria-hidden="true" />
                                                Xem
                                            </TabsTrigger>
                                            <TabsTrigger
                                                value="code"
                                                className="gap-1 px-2.5 text-xs"
                                            >
                                                <Code2 aria-hidden="true" />
                                                Mã
                                            </TabsTrigger>
                                        </TabsList>
                                    </Tabs>
                                )}
                            {draft !== null && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={saving}
                                    onClick={() => void save()}
                                    title="Lưu (Cmd/Ctrl+S)"
                                    className="h-7 gap-1 px-2 text-xs"
                                >
                                    <Save aria-hidden="true" />
                                    {saving ? 'Đang lưu...' : 'Lưu'}
                                </Button>
                            )}
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
                    {saveError !== null && (
                        <p
                            role="alert"
                            className="border-b px-3 py-1.5 text-xs text-destructive"
                        >
                            {saveError}
                        </p>
                    )}
                    {fileError !== null ? (
                        <p
                            role="alert"
                            className="m-4 text-sm text-destructive"
                        >
                            {fileError}
                        </p>
                    ) : content === null ? (
                        <LoadingRows rows={8} className="px-4 py-4" />
                    ) : image !== null ? (
                        <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-4">
                            <img
                                src={image}
                                alt={selected}
                                className="h-auto max-w-full rounded-md border bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]"
                            />
                        </div>
                    ) : preview && isMarkdown && proposed === null ? (
                        <div className="min-h-0 flex-1 overflow-auto p-4">
                            <MarkdownContent content={content} />
                        </div>
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
                                        original={base ?? content}
                                        modified={proposed}
                                    />
                                ) : (
                                    <MonacoCode
                                        path={selected}
                                        value={draft ?? content}
                                        onChange={
                                            editable
                                                ? (next) =>
                                                      setDraft(
                                                          next === content
                                                              ? null
                                                              : next,
                                                      )
                                                : undefined
                                        }
                                        onSave={() => void save()}
                                        baseline={baseline}
                                        onAsk={
                                            onAsk
                                                ? (range) =>
                                                      onAsk({
                                                          path: selected,
                                                          ...range,
                                                      })
                                                : undefined
                                        }
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
                className="relative hidden min-h-0 max-w-full shrink-0 flex-col border-l md:flex"
            >
                <ResizeHandle
                    label="Đổi độ rộng cây thư mục"
                    {...treeWidth.handleProps}
                />
                <header className="flex h-12 items-center justify-between gap-2 border-b px-3">
                    {repos.length > 1 ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Chọn dự án để xem tệp"
                                    className="flex min-w-0 items-center gap-1 rounded-md px-1 py-1 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <span className="truncate">
                                        {sourceName}
                                    </span>
                                    <ChevronDown
                                        aria-hidden="true"
                                        className="size-4 shrink-0 text-muted-foreground"
                                    />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                {repos.map((item) => (
                                    <DropdownMenuItem
                                        key={item}
                                        onSelect={() => onViewRepo(item)}
                                        className="justify-between gap-3"
                                    >
                                        <span className="truncate">
                                            {item.startsWith('local:')
                                                ? `Máy local · ${item.slice(6)}`
                                                : item}
                                        </span>
                                        {item === repo && (
                                            <Check aria-hidden="true" />
                                        )}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <span className="truncate text-sm font-medium">
                            {sourceName}
                        </span>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Thu gọn tất cả thư mục"
                        title="Thu gọn tất cả thư mục"
                        disabled={openDirs.size === 0}
                        onClick={() => setOpenDirs(new Set())}
                        className="ml-auto size-8 shrink-0 text-muted-foreground"
                    >
                        <ChevronsDownUp aria-hidden="true" />
                    </Button>
                </header>
                {localRoot !== null && (
                    <Tabs
                        value={view}
                        onValueChange={(value) =>
                            setView(value === 'changes' ? 'changes' : 'files')
                        }
                        className="border-b px-2 py-1.5"
                    >
                        <TabsList className="h-8 w-full">
                            <TabsTrigger value="files" className="text-xs">
                                Tệp
                            </TabsTrigger>
                            <TabsTrigger value="changes" className="text-xs">
                                Thay đổi
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}
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
                            <LoadingRows rows={10} className="px-2" />
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
                                changedDirs={changedDirs}
                            />
                        )}
                    </div>
                </nav>
            </aside>
        </>
    );
}
