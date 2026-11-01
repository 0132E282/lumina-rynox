import { Head, router } from '@inertiajs/react';
import { FolderOpen, FolderPlus, Link2, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '@/components/confirm-dialog';
import { downloadSelection } from '@/components/file-manager/actions';
import { GeneralContextMenu } from '@/components/file-manager/general-context-menu';
import { FileCard, FolderRow } from '@/components/file-manager/item-cards';
import { FolderPickerDialog } from '@/components/file-manager/move-dialog';
import type { FolderPickerMode } from '@/components/file-manager/move-dialog';
import { FileManagerPagination } from '@/components/file-manager/pagination';
import { PermissionsDialog } from '@/components/file-manager/permissions-dialog';
import { TableView } from '@/components/file-manager/table-view';
import {
    ALLOWED_UPLOAD_ACCEPT,
    useFileUpload,
} from '@/components/file-manager/upload';
import { ViewControls } from '@/components/file-manager/view-controls';
import type {
    SortField,
    ViewMode,
} from '@/components/file-manager/view-controls';
import { usePrompt } from '@/components/prompt-dialog';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { FileItem, Paginated } from '@/types';

type MarqueeRect = { left: number; top: number; width: number; height: number };

export default function FileManager({
    files,
    search,
    sort,
    direction,
    folderId,
}: {
    files: Paginated<FileItem>;
    search: string;
    sort: SortField;
    direction: 'asc' | 'desc';
    folderId: number | null;
    cacheSize: number;
}) {
    const confirm = useConfirm();
    const prompt = usePrompt();

    // * Picker mode (FilePickerDialog iframe): clicks toggle selection and post it to the parent;
    // * kept in sessionStorage because folder links remount the page.
    const pickerParams = new URLSearchParams(window.location.search);
    const pickerMode = pickerParams.get('picker') === '1';
    const multipleMode = pickerParams.get('multiple') === '1';
    const PICKER_STORAGE_KEY = 'file-manager-picker-selection';

    const [picked, setPicked] = useState<
        { id: number; url: string; name: string }[]
    >(() => {
        if (!pickerMode) {
            return [];
        }

        try {
            return JSON.parse(
                sessionStorage.getItem(PICKER_STORAGE_KEY) ?? '[]',
            );
        } catch {
            return [];
        }
    });

    const postSelection = (items: typeof picked) => {
        window.parent.postMessage(
            {
                type: 'file-manager:selection',
                items: items.map(({ url, name }) => ({ url, name })),
            },
            window.location.origin,
        );
    };

    useEffect(() => {
        if (pickerMode) {
            postSelection(picked);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const togglePick = (item: FileItem) => {
        if (!item.url) {
            return;
        }

        setPicked((current) => {
            const exists = current.some((p) => p.id === item.id);
            const next = multipleMode
                ? exists
                    ? current.filter((p) => p.id !== item.id)
                    : [
                          ...current,
                          { id: item.id, url: item.url!, name: item.name },
                      ]
                : exists
                  ? []
                  : [{ id: item.id, url: item.url!, name: item.name }];

            sessionStorage.setItem(PICKER_STORAGE_KEY, JSON.stringify(next));
            postSelection(next);

            return next;
        });
    };

    // * A pasted public link joins the selection like a library file (it has no id of its own, so it gets a negative one).
    const addLink = async () => {
        const raw = await prompt({
            title: 'Nhập link ảnh hoặc video',
            label: 'Đường dẫn công khai',
            placeholder: 'https://...',
            confirmLabel: 'Thêm',
        });

        if (!raw) {
            return;
        }

        let url: string;

        try {
            const parsed = new URL(raw);

            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new Error('protocol');
            }

            url = parsed.toString();
        } catch {
            window.alert('Nhập đường dẫn http(s) hợp lệ.');

            return;
        }

        setPicked((current) => {
            if (current.some((item) => item.url === url)) {
                return current;
            }

            const item = { id: -(current.length + 1), url, name: url };
            const next = multipleMode ? [...current, item] : [item];

            sessionStorage.setItem(PICKER_STORAGE_KEY, JSON.stringify(next));
            postSelection(next);

            return next;
        });
    };

    const [searchValue, setSearchValue] = useState(search ?? '');
    const [view, setView] = useState<ViewMode>('grid');
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [folderPicker, setFolderPicker] = useState<{
        ids: number[];
        mode: FolderPickerMode;
    } | null>(null);
    const [sharePicker, setSharePicker] = useState<{
        id: number;
        name: string;
    } | null>(null);
    const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

    const gridRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef(new Map<number, HTMLElement>());
    const dragStart = useRef<{ x: number; y: number } | null>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const uploadFiles = useFileUpload(folderId);

    const allItems = useMemo(() => files.data, [files.data]);
    const folders = allItems.filter((item) => item.type === 'folder');
    const items = allItems.filter((item) => item.type === 'file');

    const registerRef = (id: number, el: HTMLElement | null) => {
        if (el) {
            itemRefs.current.set(id, el);
        } else {
            itemRefs.current.delete(id);
        }
    };

    const runSearch = () => {
        router.get(
            '/file-manager',
            {
                search: searchValue,
                folder: folderId ?? undefined,
                sort,
                direction,
                picker: pickerMode ? 1 : undefined,
                multiple: multipleMode ? 1 : undefined,
            },
            { preserveState: true, replace: true },
        );
    };

    const applySort = (field: SortField) => {
        const nextDirection =
            field === sort && direction === 'asc' ? 'desc' : 'asc';

        router.get(
            '/file-manager',
            {
                search: searchValue,
                folder: folderId ?? undefined,
                sort: field,
                direction: nextDirection,
                picker: pickerMode ? 1 : undefined,
                multiple: multipleMode ? 1 : undefined,
            },
            {
                preserveState: true,
                preserveScroll: true,
                replace: true,
                only: ['files', 'sort', 'direction'],
            },
        );
    };

    const handleNewFolder = async () => {
        const name = await prompt({
            title: 'Tạo thư mục mới',
            label: 'Tên thư mục',
            confirmLabel: 'Tạo',
        });

        if (name) {
            router.post('/file-manager/folders', { name, parent_id: folderId });
        }
    };

    const toggleSelect = (id: number) => {
        setSelectedIds((prev) =>
            prev.includes(id)
                ? prev.filter((existing) => existing !== id)
                : [...prev, id],
        );
    };

    const selectedNames = () =>
        allItems
            .filter((item) => selectedIds.includes(item.id))
            .map((item) => item.name);

    const clearSelection = () => {
        setSelectMode(false);
        setSelectedIds([]);
    };

    const bulkActions = {
        count: selectedIds.length,
        onCopy: () => setFolderPicker({ ids: selectedIds, mode: 'copy' }),
        onCut: () => setFolderPicker({ ids: selectedIds, mode: 'move' }),
        onDownload: async () => {
            if (selectedIds.length <= 1) {
                downloadSelection(selectedIds, selectedNames()[0] ?? 'files');

                return;
            }

            const name = await prompt({
                title: 'Tên tệp zip',
                defaultValue: selectedNames()[0] ?? 'files',
                confirmLabel: 'Tải xuống',
            });

            if (name) {
                downloadSelection(selectedIds, name);
            }
        },
        onCompress: async () => {
            const name = await prompt({
                title: 'Tên file nén',
                defaultValue: selectedNames()[0] ?? 'archive',
                confirmLabel: 'Nén',
            });

            if (!name) {
                return;
            }

            router.post(
                '/file-manager/compress',
                { ids: selectedIds, name },
                { preserveScroll: true, onSuccess: clearSelection },
            );
        },
        onDelete: async () => {
            const ok = await confirm({
                title: `Xóa ${selectedIds.length} mục đã chọn?`,
                description: 'Các mục này sẽ được chuyển vào thùng rác.',
                confirmLabel: 'Xóa',
                destructive: true,
            });

            if (ok) {
                router.post(
                    '/file-manager/bulk-destroy',
                    { ids: selectedIds },
                    { preserveScroll: true, onSuccess: clearSelection },
                );
            }
        },
    };

    const handlePickFolder = (targetId: number | null) => {
        if (!folderPicker) {
            return;
        }

        const endpoint =
            folderPicker.mode === 'move'
                ? '/file-manager/move'
                : '/file-manager/duplicate';

        router.post(
            endpoint,
            { ids: folderPicker.ids, target_id: targetId },
            { preserveScroll: true },
        );
        setFolderPicker(null);
        clearSelection();
    };

    // * Rubber-band selection: dragging over the grid selects everything touched and enables select mode.
    useEffect(() => {
        const grid = gridRef.current;

        if (!grid) {
            return;
        }

        // * Stop the native drag-image from hijacking the marquee.
        const onNativeDragStart = (e: DragEvent) => e.preventDefault();

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) {
                return;
            }

            // * Bail out only on controls; dragging may start on a thumbnail.
            if ((e.target as HTMLElement).closest('button, a')) {
                return;
            }

            dragStart.current = { x: e.clientX, y: e.clientY };
            setMarquee({
                left: e.clientX,
                top: e.clientY,
                width: 0,
                height: 0,
            });
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!dragStart.current) {
                return;
            }

            const left = Math.min(dragStart.current.x, e.clientX);
            const top = Math.min(dragStart.current.y, e.clientY);
            const width = Math.abs(e.clientX - dragStart.current.x);
            const height = Math.abs(e.clientY - dragStart.current.y);

            setMarquee({ left, top, width, height });
        };

        const onMouseUp = () => {
            if (!dragStart.current) {
                return;
            }

            setMarquee((rect) => {
                if (rect && (rect.width > 4 || rect.height > 4)) {
                    const hits: number[] = [];

                    itemRefs.current.forEach((el, id) => {
                        const box = el.getBoundingClientRect();
                        const intersects =
                            rect.left < box.right &&
                            rect.left + rect.width > box.left &&
                            rect.top < box.bottom &&
                            rect.top + rect.height > box.top;

                        if (intersects) {
                            hits.push(id);
                        }
                    });

                    if (hits.length > 0) {
                        setSelectMode(true);
                        setSelectedIds((prev) =>
                            Array.from(new Set([...prev, ...hits])),
                        );
                    }
                }

                return null;
            });

            dragStart.current = null;
        };

        grid.addEventListener('mousedown', onMouseDown);
        grid.addEventListener('dragstart', onNativeDragStart);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        return () => {
            grid.removeEventListener('mousedown', onMouseDown);
            grid.removeEventListener('dragstart', onNativeDragStart);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    return (
        <div
            className={`flex flex-1 flex-col gap-6 ${pickerMode ? 'min-h-screen bg-background p-6' : 'p-4'}`}
        >
            <Head title="File Manager" />

            {marquee && (
                <div
                    className="fixed z-50 border border-primary bg-primary/10"
                    style={{
                        left: marquee.left,
                        top: marquee.top,
                        width: marquee.width,
                        height: marquee.height,
                    }}
                />
            )}

            <FolderPickerDialog
                open={folderPicker !== null}
                mode={folderPicker?.mode ?? 'move'}
                excludeIds={folderPicker?.ids ?? []}
                onOpenChange={(open) => !open && setFolderPicker(null)}
                onPick={handlePickFolder}
            />

            <PermissionsDialog
                fileId={sharePicker?.id ?? null}
                fileName={sharePicker?.name ?? ''}
                open={sharePicker !== null}
                onOpenChange={(open) => !open && setSharePicker(null)}
            />

            <div className="flex items-center justify-between gap-2">
                <div className="relative w-full max-w-md">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchValue}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setSearchValue(e.target.value)
                        }
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
                            e.key === 'Enter' && runSearch()
                        }
                        placeholder="Tìm kiếm tệp..."
                        className="pl-9"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <ViewControls
                        sort={sort}
                        direction={direction}
                        view={view}
                        onSortChange={applySort}
                        onViewChange={setView}
                    />

                    {pickerMode && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleNewFolder}
                            >
                                <FolderPlus className="size-4" />
                                Thư mục mới
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button type="button" variant="outline">
                                        <Upload className="size-4" />
                                        Tải ảnh lên
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            uploadInputRef.current?.click()
                                        }
                                    >
                                        <Upload className="size-4" />
                                        Tải từ hệ thống
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={addLink}>
                                        <Link2 className="size-4" />
                                        Nhập link
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </>
                    )}
                </div>
            </div>

            <GeneralContextMenu
                bulk={selectedIds.length > 0 ? bulkActions : undefined}
                onNewFolder={handleNewFolder}
                onUploadClick={() => uploadInputRef.current?.click()}
            >
                {files.data.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-16 text-muted-foreground">
                        <FolderOpen className="size-6" />
                        <p className="text-sm">Thư mục trống</p>
                    </div>
                ) : view === 'table' ? (
                    <div ref={gridRef} className="select-none">
                        <TableView
                            folders={folders}
                            files={items}
                            selectable={selectMode}
                            selectedIds={selectedIds}
                            bulk={bulkActions}
                            onToggleSelect={toggleSelect}
                            onMoveClick={(id) =>
                                setFolderPicker({ ids: [id], mode: 'move' })
                            }
                            onShareClick={(id) => {
                                const target = allItems.find(
                                    (item) => item.id === id,
                                );

                                if (target) {
                                    setSharePicker({
                                        id: target.id,
                                        name: target.name,
                                    });
                                }
                            }}
                            registerRef={registerRef}
                        />
                    </div>
                ) : (
                    <div ref={gridRef} className="space-y-4 select-none">
                        {folders.length > 0 && (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                                {folders.map((item) => (
                                    <FolderRow
                                        key={item.id}
                                        item={item}
                                        selectable={selectMode}
                                        selected={selectedIds.includes(item.id)}
                                        bulk={bulkActions}
                                        onToggleSelect={() =>
                                            toggleSelect(item.id)
                                        }
                                        onMoveClick={() =>
                                            setFolderPicker({
                                                ids: [item.id],
                                                mode: 'move',
                                            })
                                        }
                                        onShareClick={() =>
                                            setSharePicker({
                                                id: item.id,
                                                name: item.name,
                                            })
                                        }
                                        registerRef={registerRef}
                                        pickerQuery={
                                            pickerMode
                                                ? `&picker=1${multipleMode ? '&multiple=1' : ''}`
                                                : undefined
                                        }
                                    />
                                ))}
                            </div>
                        )}

                        {items.length > 0 && (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                                {items.map((item) => (
                                    <FileCard
                                        key={item.id}
                                        item={item}
                                        selectable={selectMode}
                                        selected={selectedIds.includes(item.id)}
                                        bulk={bulkActions}
                                        onToggleSelect={() =>
                                            toggleSelect(item.id)
                                        }
                                        onMoveClick={() =>
                                            setFolderPicker({
                                                ids: [item.id],
                                                mode: 'move',
                                            })
                                        }
                                        onShareClick={() => {}}
                                        registerRef={registerRef}
                                        onPick={
                                            pickerMode
                                                ? () => togglePick(item)
                                                : undefined
                                        }
                                        picked={picked.some(
                                            (p) => p.id === item.id,
                                        )}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </GeneralContextMenu>

            <input
                ref={uploadInputRef}
                type="file"
                multiple
                accept={ALLOWED_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                        uploadFiles(e.target.files);
                    }

                    e.target.value = '';
                }}
            />

            <FileManagerPagination files={files} />
        </div>
    );
}
