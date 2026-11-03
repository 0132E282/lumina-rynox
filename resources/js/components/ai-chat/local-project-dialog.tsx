import { Folder, Info, Lock, Plus, Trash2, X } from 'lucide-react';
import { requestErrorMessage } from '@/lib/ai-error';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field, Form } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAppForm } from '@/hooks/use-app-form';
import { api } from '@/lib/api';
import { SourceIcon } from '@/components/ai-chat/source-icon';
import { pickFolder } from '@/lib/pick-folder';
import { cn } from '@/lib/utils';
import type { AiChatRepo } from '@/types';

export type LocalRoot = {
    id: string;
    label: string;
    imported: boolean;
    folder: string | null;
};

export type LocalProject = {
    key: string;
    name: string;
    folders: { id: string; folder: string }[];
};

export type LocalProjectsChange = {
    roots: LocalRoot[];
    projects: LocalProject[];
};

type ProjectForm = { name: string; folders: string[] };

const MAX_FOLDERS = 5;
/** * One main repo plus up to three read together with it (as the chat accepts). */
const MAX_REPOS = 4;
const MAX_NAME = 60;

/** * Last folder of an absolute path as a project name: only letters, digits, space, `_`, `.`, `-`, starting with a letter or digit, at most MAX_NAME characters. */
function defaultProjectName(path: string): string {
    const last = path.split('/').filter(Boolean).pop() ?? '';

    return last
        .replace(/[^\p{L}\p{N} _.-]/gu, '-')
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .slice(0, MAX_NAME);
}

/** * "Tạo dự án" for the local source: a name plus one to five folders of this machine. The browser cannot give a server path, "Thêm" opens the browser's own folder dialog; only the folder's name and listing go to the server, which finds the real folder again inside the allowed area and checks it again on import. */
export function LocalProjectDialog({
    open,
    onOpenChange,
    projects,
    onChanged,
    unavailable = null,
    githubRepos = null,
    localRoots = [],
    selected = [],
    title = 'Chọn dự án',
    projectTitle = '',
    initialSource,
    onPickRepos,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projects: LocalProject[];
    onChanged: (change: LocalProjectsChange) => void;
    /** * Why creating is not possible right now (local access off or not allowed); shown in the dialog and the create button stays off. */
    unavailable?: string | null;
    /** * The repos the GitHub token can read (null while loading or not connected); picking one opens it as the project. */
    githubRepos?: AiChatRepo[] | null;
    /** * Folders the server already allows; ticking one picks it like a repo (`local:<id>`). */
    localRoots?: LocalRoot[];
    /** * Projects picked right now: ticked again each time the dialog opens. */
    selected?: string[];
    title?: string;
    /** * Name given to the picked repos last time (shown again when the dialog opens). */
    projectTitle?: string;
    /** * Tab shown first (the person's own choice afterwards); by default GitHub when it is connected. */
    initialSource?: 'github' | 'local';
    /** * Called with the ticked projects: the first is the main project, the others join it as read-only context. */
    onPickRepos?: (repos: string[], projectTitle: string) => void;
}) {
    const [picked, setSource] = useState<'github' | 'local' | null>(null);
    // * Until the person chooses, GitHub is the source when it is connected, otherwise this machine.
    const source =
        picked ?? initialSource ?? (githubRepos === null ? 'local' : 'github');
    const [repoSearch, setRepoSearch] = useState('');
    const [ticked, setTicked] = useState<string[]>(selected);
    const [pickTitle, setPickTitle] = useState(projectTitle);

    useEffect(() => {
        if (open) {
            setTicked(selected);
            setPickTitle(projectTitle);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    const form = useAppForm<ProjectForm>({
        defaultValues: { name: '', folders: [] },
    });
    // * True while the machine's own folder dialog is open and we wait for the answer.
    const [picking, setPicking] = useState(false);
    const [removing, setRemoving] = useState<string | null>(null);
    const name = form.watch('name');
    const folders = form.watch('folders');
    const folderError = form.formState.errors.folders?.message;
    const canCreate =
        unavailable === null && name.trim() !== '' && folders.length > 0;

    const toggleRepo = (name: string) =>
        setTicked((current) =>
            current.includes(name)
                ? current.filter((item) => item !== name)
                : current.length < MAX_REPOS
                  ? [...current, name]
                  : current,
        );

    const confirmPick = () => {
        onPickRepos?.(ticked, pickTitle.trim().slice(0, MAX_NAME));
        close(false);
    };
    const pickLabel =
        ticked.length === 0 ? 'Bỏ chọn dự án' : `Mở ${ticked.length} dự án`;

    const confirmFolder = (value: string) => {
        if (folders.includes(value)) {
            form.setError('folders', { message: 'Thư mục này đã được thêm.' });

            return;
        }

        form.clearErrors('folders');
        form.setValue('folders', [...folders, value]);

        // * An empty name defaults to the folder's own name, cleaned to what the server accepts.
        if (name.trim() === '') {
            form.setValue('name', defaultProjectName(value));
        }
    };

    const chooseFolder = async () => {
        setPicking(true);
        form.clearErrors('folders');

        try {
            const picked = await pickFolder();

            if (picked === null) {
                return;
            }

            // * The browser gives a name and a listing; the server finds the real folder again (inside the allowed area only).
            const { data } = await api.post<{ folder: string }>(
                '/ai-chat/local/find-folder',
                picked,
            );

            confirmFolder(data.folder);
        } catch (caught) {
            form.setError('folders', {
                message: requestErrorMessage(
                    caught,
                    'Không thêm được thư mục này.',
                ),
            });
        } finally {
            setPicking(false);
        }
    };

    const removeFolder = (index: number) => {
        form.clearErrors('folders');
        form.setValue(
            'folders',
            folders.filter((_, position) => position !== index),
        );
    };

    const close = (next: boolean) => {
        if (!next) {
            form.reset();
            setPicking(false);
        }

        onOpenChange(next);
    };

    const removeProject = async (project: LocalProject) => {
        setRemoving(project.key);

        try {
            const { data } = await api.delete<LocalProjectsChange>(
                `/ai-chat/local/projects/${project.key}`,
            );

            onChanged(data);
            toast.success(`Đã xóa dự án "${project.name}".`);
        } catch (caught) {
            toast.error(requestErrorMessage(caught, 'Không xóa được dự án.'));
        } finally {
            setRemoving(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent
                // * The first tab would take the focus ring on open; the person types or ticks next.
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        Chọn repo GitHub hoặc thư mục trên máy để trò chuyện và
                        xem tệp ngay trong dự án.
                    </DialogDescription>
                </DialogHeader>
                <div
                    className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
                    role="tablist"
                    aria-label="Nguồn dự án"
                >
                    {(['github', 'local'] as const).map((item) => (
                        <Button
                            key={item}
                            type="button"
                            role="tab"
                            aria-selected={source === item}
                            variant="ghost"
                            size="sm"
                            className={cn(
                                'rounded-md',
                                source === item
                                    ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border hover:bg-background'
                                    : 'text-muted-foreground',
                            )}
                            onClick={() => setSource(item)}
                        >
                            {item === 'github' ? 'GitHub' : 'Máy này'}
                        </Button>
                    ))}
                </div>
                {source === 'github' ? (
                    <div className="flex flex-col gap-2">
                        {githubRepos === null ? (
                            <p className="text-sm text-muted-foreground">
                                Chưa kết nối GitHub hoặc đang tải danh sách
                                repo.
                            </p>
                        ) : (
                            <>
                                <div className="flex flex-col gap-1">
                                    <label
                                        htmlFor="pick-project-title"
                                        className="text-sm font-medium"
                                    >
                                        Tên dự án
                                    </label>
                                    <Input
                                        id="pick-project-title"
                                        value={pickTitle}
                                        maxLength={MAX_NAME}
                                        autoComplete="off"
                                        placeholder={
                                            ticked[0] === undefined
                                                ? 'Ví dụ: Website công ty'
                                                : (ticked[0]
                                                      .replace('local:', '')
                                                      .split('/')
                                                      .pop() ?? '')
                                        }
                                        onChange={(event) =>
                                            setPickTitle(event.target.value)
                                        }
                                    />
                                </div>
                                <div className="overflow-hidden rounded-xl border">
                                    <Input
                                        value={repoSearch}
                                        onChange={(event) =>
                                            setRepoSearch(event.target.value)
                                        }
                                        aria-label="Tìm repo"
                                        placeholder="Tìm repo..."
                                        className="rounded-none border-0 border-b shadow-none focus-visible:ring-0"
                                    />
                                    <ul className="flex max-h-[min(55vh,30rem)] min-h-40 flex-col gap-0.5 overflow-y-auto p-1">
                                        {githubRepos
                                            .filter((row) =>
                                                row.full_name
                                                    .toLowerCase()
                                                    .includes(
                                                        repoSearch
                                                            .trim()
                                                            .toLowerCase(),
                                                    ),
                                            )
                                            .map((row) => (
                                                <li key={row.full_name}>
                                                    <label className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                                                        <Checkbox
                                                            checked={ticked.includes(
                                                                row.full_name,
                                                            )}
                                                            disabled={
                                                                !ticked.includes(
                                                                    row.full_name,
                                                                ) &&
                                                                ticked.length >=
                                                                    MAX_REPOS
                                                            }
                                                            onCheckedChange={() =>
                                                                toggleRepo(
                                                                    row.full_name,
                                                                )
                                                            }
                                                        />
                                                        <SourceIcon
                                                            local={false}
                                                            className="text-muted-foreground"
                                                        />
                                                        <span className="truncate">
                                                            {row.full_name}
                                                        </span>
                                                        {row.private && (
                                                            <Lock
                                                                aria-label="Riêng tư"
                                                                className="size-3 shrink-0 text-muted-foreground"
                                                            />
                                                        )}
                                                    </label>
                                                </li>
                                            ))}
                                    </ul>
                                </div>
                                <DialogFooter className="items-center sm:justify-between">
                                    <p className="text-xs text-muted-foreground">
                                        Đã chọn {ticked.length}/{MAX_REPOS}.
                                        Repo đầu tiên là dự án chính, các repo
                                        còn lại AI đọc cùng.
                                    </p>
                                    <Button
                                        type="button"
                                        className="rounded-full"
                                        disabled={
                                            ticked.length === 0 &&
                                            selected.length === 0
                                        }
                                        onClick={confirmPick}
                                    >
                                        {pickLabel}
                                    </Button>
                                </DialogFooter>
                            </>
                        )}
                    </div>
                ) : (
                    <>
                        <Form
                            form={form}
                            withFieldGroup={false}
                            className="flex flex-col gap-4"
                            onSubmit={form.submit(
                                'ai-chat.local.projects.store',
                                'post',
                                {
                                    onSuccess: (data) => {
                                        onChanged(
                                            data as unknown as LocalProjectsChange,
                                        );
                                        toast.success('Đã tạo dự án.');
                                        close(false);
                                    },
                                    onError: (errors) => {
                                        if (
                                            errors.name === undefined &&
                                            errors.folders === undefined
                                        ) {
                                            toast.error(
                                                'Không tạo được dự án.',
                                            );
                                        }
                                    },
                                },
                            )}
                        >
                            {unavailable !== null && (
                                <p
                                    role="alert"
                                    className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
                                >
                                    {unavailable}
                                </p>
                            )}
                            <Field
                                name="name"
                                label="Tên dự án"
                                maxLength={MAX_NAME}
                                placeholder="Ví dụ: Website công ty"
                                autoComplete="off"
                            />
                            <section
                                aria-label="Thư mục nguồn"
                                className="flex flex-col gap-2"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-sm font-medium">
                                        Thư mục nguồn
                                    </h3>
                                    {picking && (
                                        <span className="ml-auto text-xs text-muted-foreground">
                                            Đang chờ chọn thư mục...
                                        </span>
                                    )}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 gap-1.5 rounded-md px-2.5 text-xs"
                                        aria-label="Thêm thư mục"
                                        title="Thêm thư mục"
                                        disabled={
                                            picking ||
                                            folders.length >= MAX_FOLDERS
                                        }
                                        onClick={() => void chooseFolder()}
                                    >
                                        <Plus aria-hidden="true" />
                                        Thêm mới
                                    </Button>
                                </div>
                                <div className="flex min-h-48 flex-col gap-2 rounded-xl border p-3">
                                    {folders.length === 0 && !picking && (
                                        <p className="my-auto text-center text-sm text-muted-foreground">
                                            Thêm thư mục trên{' '}
                                            <span className="text-foreground">
                                                máy này
                                            </span>
                                        </p>
                                    )}
                                    {folders.map((folder, index) => (
                                        <div
                                            key={folder}
                                            className="flex items-center gap-2 text-sm"
                                        >
                                            <Folder
                                                className="size-4 shrink-0 text-muted-foreground"
                                                aria-hidden="true"
                                            />
                                            <span
                                                className="min-w-0 flex-1 truncate"
                                                title={folder}
                                            >
                                                {folder}
                                            </span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-7"
                                                aria-label={`Xóa thư mục ${folder}`}
                                                onClick={() =>
                                                    removeFolder(index)
                                                }
                                            >
                                                <X aria-hidden="true" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                                {folderError && (
                                    <p
                                        role="alert"
                                        className="text-sm text-destructive"
                                    >
                                        {folderError}
                                    </p>
                                )}
                            </section>
                            <p className="flex gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
                                <Info
                                    className="mt-0.5 size-4 shrink-0"
                                    aria-hidden="true"
                                />
                                Dự án gom cuộc trò chuyện và tệp của thư mục
                                local vào một chỗ. Chỉ thư mục trong khu vực
                                được phép mới thêm được; các tệp bí mật luôn bị
                                chặn.
                            </p>
                            {projects.length > 0 && (
                                <section
                                    aria-label="Dự án đã tạo"
                                    className="flex flex-col gap-1"
                                >
                                    <h3 className="text-sm font-medium">
                                        Dự án đã tạo
                                    </h3>
                                    <ul className="flex flex-col gap-1">
                                        {projects.map((project) => (
                                            <li
                                                key={project.key}
                                                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                                            >
                                                <span className="min-w-0 flex-1 leading-tight">
                                                    <span className="block truncate font-medium">
                                                        {project.name}
                                                    </span>
                                                    <span className="block truncate text-xs text-muted-foreground">
                                                        {project.folders
                                                            .map(
                                                                (item) =>
                                                                    item.folder,
                                                            )
                                                            .join(', ')}
                                                    </span>
                                                </span>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="size-7"
                                                    disabled={
                                                        removing === project.key
                                                    }
                                                    aria-label={`Xóa dự án ${project.name}`}
                                                    onClick={() =>
                                                        void removeProject(
                                                            project,
                                                        )
                                                    }
                                                >
                                                    <Trash2 aria-hidden="true" />
                                                </Button>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="rounded-full"
                                    onClick={() => close(false)}
                                >
                                    Hủy
                                </Button>
                                <Button
                                    type="submit"
                                    className="rounded-full"
                                    disabled={
                                        !canCreate ||
                                        form.formState.isSubmitting
                                    }
                                >
                                    Tạo dự án
                                </Button>
                            </DialogFooter>
                        </Form>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** * Why a project cannot be created from this machine right now, or null when it can. */
export function localUnavailableReason(
    local: { enabled: boolean; can_write: boolean } | null,
): string | null {
    if (local === null) {
        return 'Đang kiểm tra kết nối local, thử lại sau giây lát.';
    }

    if (!local.enabled) {
        return 'Chưa bật kết nối local. Để bật, đặt trong .env: AI_CHAT_LOCAL_ENABLED=true và AI_CHAT_LOCAL_ROOTS=ten=/duong/dan/thu/muc (chỉ chạy ở localhost, không dùng trên production).';
    }

    return local.can_write ? null : 'Bạn chưa có quyền tạo dự án local.';
}
