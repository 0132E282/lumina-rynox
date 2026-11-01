import { Head, Link, router } from '@inertiajs/react';
import {
    CalendarClock,
    Copy,
    RotateCw,
    Send,
    Square,
    Trash2,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
    destroy,
    cancel,
    destroyMany,
    dismiss,
    duplicate,
    edit,
    index,
    publish,
    reschedule,
    retry,
} from '@/actions/App/Http/Controllers/PostController';
import { useConfirm } from '@/components/confirm-dialog';
import InputError from '@/components/input-error';
import { PlatformLogo } from '@/components/social/platform-logo';
import { PlatformTabs } from '@/components/social/platform-tabs';
import { createSelectColumn } from '@/components/tables/columns';
import { DataTable } from '@/components/tables/data-table';
import { RowActionsMenu } from '@/components/tables/row-actions-menu';
import { TargetName } from '@/components/posts/target-name';
import {
    PostStatusBadge,
    TARGET_STATUS,
    shouldShowDeliveryError,
} from '@/components/posts/post-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import { formatDateTimePersonal } from '@/lib/personal-date';
import type {
    PostRow,
    PostsIndexProps,
    PostStatus,
    PostTab,
    PostTargetRow,
} from '@/types';

const ALL_STATES = 'all';
// * Targets listed per post before "Xem tất cả".
const TARGETS_SHOWN = 4;

// * Exact post statuses (finer than the tabs, which group several of them).
const STATES: { value: PostStatus; label: string }[] = [
    { value: 'draft', label: 'Nháp' },
    { value: 'scheduled', label: 'Đã lên lịch' },
    { value: 'publishing', label: 'Đang đăng' },
    { value: 'published', label: 'Đã đăng' },
    { value: 'partial', label: 'Đăng một phần' },
    { value: 'failed', label: 'Lỗi đăng' },
    { value: 'missed', label: 'Đã lỡ lịch' },
];

function relativeTime(iso: string): string {
    const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    const days = Math.round(minutes / 1440);

    if (minutes < 0) {
        return 'Đã quá giờ';
    }

    if (minutes < 60) {
        return `Còn ${Math.max(minutes, 1)} phút`;
    }

    return minutes < 1440
        ? `Còn ${Math.round(minutes / 60)} giờ`
        : `Còn ${days} ngày`;
}

function TimeCell({ post }: { post: PostRow }) {
    if (post.published_at) {
        return <div>{formatDateTimePersonal(post.published_at)}</div>;
    }

    if (!post.scheduled_at) {
        return <span>Chưa đặt giờ</span>;
    }

    return (
        <>
            <div>{formatDateTimePersonal(post.scheduled_at)}</div>
            {(post.status === 'scheduled' || post.status === 'missed') && (
                <div className="text-xs text-muted-foreground">
                    {relativeTime(post.scheduled_at)}
                </div>
            )}
        </>
    );
}

type RescheduleState = { post: PostRow; date: string; time: string };

export default function PostsIndex({
    posts,
    filters,
    counts,
    providers,
    can,
}: PostsIndexProps) {
    const confirm = useConfirm();
    const [search, setSearch] = useState(filters.q);
    const debouncedSearch = useDebounce(search, 300);
    const [rescheduling, setRescheduling] = useState<RescheduleState | null>(
        null,
    );
    const [rescheduleError, setRescheduleError] = useState<string>();
    const [busy, setBusy] = useState(false);
    // * Latest filters for the debounced search effect, so it never navigates with a stale tab or provider.
    const filtersRef = useRef(filters);
    filtersRef.current = filters;

    const navigate = (
        next: Partial<{
            status: PostTab;
            state: PostStatus | null;
            provider: string | null;
            q: string;
            page: number;
        }>,
    ) => {
        const merged = { ...filtersRef.current, ...next };

        router.get(
            index.url({
                query: {
                    ...(merged.status !== 'all'
                        ? { status: merged.status }
                        : {}),
                    ...(merged.state ? { state: merged.state } : {}),
                    ...(merged.provider ? { provider: merged.provider } : {}),
                    ...(merged.q !== '' ? { q: merged.q } : {}),
                    ...(next.page && next.page > 1 ? { page: next.page } : {}),
                },
            }),
            {},
            { preserveState: true, preserveScroll: true, replace: true },
        );
    };

    useEffect(() => {
        if (debouncedSearch !== filtersRef.current.q) {
            navigate({ q: debouncedSearch });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch]);

    const act = (
        url: string,
        data: Record<string, string | number | boolean> = {},
    ) => {
        setBusy(true);
        router.post(url, data, {
            preserveScroll: true,
            onFinish: () => setBusy(false),
        });
    };

    const publishNow = async (post: PostRow) => {
        if (
            await confirm({
                title: 'Đăng ngay?',
                description:
                    'Bài viết sẽ được đăng lên các nền tảng đã chọn ngay bây giờ.',
                confirmLabel: 'Đăng ngay',
            })
        ) {
            act(publish.url({ post: post.id }));
        }
    };

    const dismissMissed = async (post: PostRow) => {
        if (
            await confirm({
                title: 'Bỏ lịch đăng?',
                description:
                    'Bài viết chuyển về nháp và sẽ không được đăng tự động.',
                confirmLabel: 'Bỏ lịch',
            })
        ) {
            act(dismiss.url({ post: post.id }));
        }
    };

    const cancelPost = async (post: PostRow) => {
        if (
            await confirm({
                title: 'Dừng đăng bài viết?',
                description:
                    'Các nơi đang chờ sẽ không được đăng nữa. Nơi đang chạy có thể đã lên nền tảng dù hệ thống ghi đã dừng.',
                confirmLabel: 'Dừng đăng',
                destructive: true,
            })
        ) {
            act(cancel.url({ post: post.id }));
        }
    };

    const duplicatePost = (post: PostRow) => {
        setBusy(true);
        router.post(
            duplicate.url({ post: post.id }),
            {},
            { onFinish: () => setBusy(false) },
        );
    };

    // * Posts whose full target list is open; the others show the first few plus every target that needs attention.
    const [expanded, setExpanded] = useState<number[]>([]);

    const removeSelected = async (rows: PostRow[]) => {
        if (
            await confirm({
                title: `Xoá ${rows.length} bài viết?`,
                description:
                    'Bài đã đăng trên nền tảng không bị xoá theo; chỉ xoá bản ghi trong hệ thống.',
                confirmLabel: 'Xoá',
                destructive: true,
            })
        ) {
            router.delete(destroyMany.url(), {
                data: { ids: rows.map((row) => row.id) },
                preserveScroll: true,
            });
        }
    };

    // * DataTable pushes its toolbar buttons to the header with these as hook deps, so they must keep one identity between renders.
    const removeSelectedRef = useRef(removeSelected);
    removeSelectedRef.current = removeSelected;
    const deleteSelected = useCallback(
        (rows: PostRow[]) => removeSelectedRef.current(rows),
        [],
    );
    const createPost = useCallback(() => router.visit('/posts/create'), []);
    const stateFilter = useMemo(
        () => (
            <Select
                value={filters.state ?? ALL_STATES}
                onValueChange={(value) =>
                    navigate({
                        status: 'all',
                        state:
                            value === ALL_STATES ? null : (value as PostStatus),
                    })
                }
            >
                <SelectTrigger aria-label="Lọc theo trạng thái">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL_STATES}>
                        Trạng thái: Tất cả
                    </SelectItem>
                    {STATES.map((state) => (
                        <SelectItem key={state.value} value={state.value}>
                            {state.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [filters.state],
    );

    const removePost = async (post: PostRow) => {
        if (
            await confirm({
                title: 'Xoá bài viết?',
                description:
                    'Bài đã đăng trên nền tảng không bị xoá theo; chỉ xoá bản ghi trong hệ thống.',
                confirmLabel: 'Xoá',
                destructive: true,
            })
        ) {
            router.delete(destroy.url({ post: post.id }), {
                preserveScroll: true,
            });
        }
    };

    const retryTarget = async (target: PostTargetRow) => {
        const unknown = target.status === 'unknown';
        const ok = await confirm(
            unknown
                ? {
                      title: `Đăng lại lên ${target.label}?`,
                      description:
                          'Có thể đã đăng: lần trước không nhận được phản hồi nên bài có thể đã xuất hiện trên nền tảng. Đăng lại có thể tạo bài trùng.',
                      confirmLabel: 'Có thể đã đăng, vẫn đăng lại',
                      destructive: true,
                  }
                : {
                      title: `Thử lại ${target.label}?`,
                      confirmLabel: 'Thử lại',
                  },
        );

        if (ok) {
            act(
                retry.url({ target: target.id }),
                unknown ? { confirm_maybe_published: true } : {},
            );
        }
    };

    const submitReschedule = (event: FormEvent) => {
        event.preventDefault();

        if (!rescheduling) {
            return;
        }

        setBusy(true);
        router.post(
            reschedule.url({ post: rescheduling.post.id }),
            {
                scheduled_date: rescheduling.date,
                scheduled_time: rescheduling.time,
            },
            {
                preserveScroll: true,
                onSuccess: () => setRescheduling(null),
                onError: (errors) =>
                    setRescheduleError(
                        errors.scheduled_date ?? errors.scheduled_time,
                    ),
                onFinish: () => setBusy(false),
            },
        );
    };

    const openReschedule = (post: PostRow) => {
        setRescheduleError(undefined);
        setRescheduling({ post, date: '', time: '09:00' });
    };

    // * Memoised: DataTable renders cells as components, so a new array each render would remount every cell. The handlers only call stable setters, confirm and router, so they stay valid between the listed changes.
    const columns = useMemo<ColumnDef<PostRow>[]>(
        () => [
            createSelectColumn<PostRow>((post) => post.id),
            {
                id: 'post',
                meta: { label: 'Bài viết' },
                header: 'Bài viết',
                enableSorting: false,
                size: 300,
                cell: ({ row }) => {
                    const post = row.original;

                    return (
                        <div className="whitespace-normal">
                            {post.editable && can.update ? (
                                <Link
                                    href={edit.url({ post: post.id })}
                                    className="font-medium text-blue-600 dark:text-blue-400"
                                >
                                    {post.title ?? post.excerpt}
                                </Link>
                            ) : (
                                <span className="font-medium">
                                    {post.title ?? post.excerpt}
                                </span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'targets',
                meta: { label: 'Đăng trên' },
                header: 'Đăng trên',
                enableSorting: false,
                size: 600,
                cell: ({ row }) => {
                    const post = row.original;

                    return (
                        <div className="whitespace-normal">
                            <ul className="flex flex-wrap gap-x-2 gap-y-1.5">
                                {post.targets.length === 0 && (
                                    <li className="text-muted-foreground">
                                        Chưa chọn nền tảng
                                    </li>
                                )}
                                {post.targets
                                    .filter(
                                        (target, index) =>
                                            expanded.includes(post.id) ||
                                            index < TARGETS_SHOWN ||
                                            target.status === 'failed' ||
                                            target.status === 'unknown',
                                    )
                                    .map((target) => {
                                        const state =
                                            TARGET_STATUS[target.status];
                                        const StateIcon = state.icon;

                                        return (
                                            <li
                                                key={target.id}
                                                className="flex max-w-full min-w-0 flex-col gap-0.5"
                                                title={`${target.label}${target.group ? ` · ${target.group}` : ''}`}
                                            >
                                                <Badge
                                                    variant={
                                                        target.status ===
                                                        'failed'
                                                            ? 'destructive'
                                                            : 'outline'
                                                    }
                                                    className="max-w-full min-w-0"
                                                >
                                                    <PlatformLogo
                                                        provider={
                                                            target.provider
                                                        }
                                                        letter={target.letter}
                                                        color={target.color}
                                                        className="size-4"
                                                    />
                                                    <TargetName
                                                        target={target}
                                                    />
                                                    {target.status !==
                                                        'published' && (
                                                        <span
                                                            title={
                                                                target.status_label
                                                            }
                                                            className={`flex shrink-0 items-center ${target.status === 'failed' ? '' : state.className}`}
                                                        >
                                                            <StateIcon
                                                                aria-label={
                                                                    target.status_label
                                                                }
                                                                className={`size-3.5 ${target.status === 'publishing' ? 'animate-spin' : ''}`}
                                                            />
                                                        </span>
                                                    )}
                                                </Badge>
                                                {shouldShowDeliveryError(
                                                    target.error,
                                                ) && (
                                                    <span className="line-clamp-2 pl-2 text-xs text-muted-foreground">
                                                        {target.error}
                                                    </span>
                                                )}
                                            </li>
                                        );
                                    })}
                                {post.targets.length > TARGETS_SHOWN && (
                                    <li className="w-full">
                                        <button
                                            type="button"
                                            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                                            onClick={() =>
                                                setExpanded((current) =>
                                                    current.includes(post.id)
                                                        ? current.filter(
                                                              (id) =>
                                                                  id !==
                                                                  post.id,
                                                          )
                                                        : [...current, post.id],
                                                )
                                            }
                                        >
                                            {expanded.includes(post.id)
                                                ? 'Thu gọn'
                                                : `Xem tất cả ${post.targets.length} nơi đăng`}
                                        </button>
                                    </li>
                                )}
                            </ul>
                        </div>
                    );
                },
            },
            {
                id: 'status',
                meta: { label: 'Trạng thái' },
                header: 'Trạng thái',
                enableSorting: false,
                cell: ({ row }) => {
                    const post = row.original;

                    return (
                        <>
                            <PostStatusBadge status={post.status} />
                            {post.status === 'missed' && can.publish && (
                                <div className="mt-2 flex flex-col items-start gap-1 text-xs">
                                    <span className="text-muted-foreground">
                                        Đã lỡ lịch, không tự đăng.
                                    </span>
                                    <span className="flex flex-wrap gap-1">
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="h-6 px-2 text-xs"
                                            disabled={busy || !post.awaiting}
                                            onClick={() => publishNow(post)}
                                        >
                                            Đăng ngay
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-6 px-2 text-xs"
                                            disabled={busy}
                                            onClick={() => openReschedule(post)}
                                        >
                                            Hẹn lại
                                        </Button>
                                        {can.update && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-6 px-2 text-xs"
                                                disabled={busy}
                                                onClick={() =>
                                                    dismissMissed(post)
                                                }
                                            >
                                                Bỏ
                                            </Button>
                                        )}
                                    </span>
                                </div>
                            )}
                        </>
                    );
                },
            },
            {
                id: 'time',
                meta: { label: 'Thời gian đăng' },
                header: 'Thời gian đăng',
                enableSorting: false,
                cell: ({ row }) => {
                    const post = row.original;

                    return (
                        <>
                            <TimeCell post={post} />
                        </>
                    );
                },
            },
            {
                id: 'actions',
                meta: { label: 'Hành động' },
                enableHiding: false,
                header: () => <span className="sr-only">Thao tác</span>,
                enableSorting: false,
                size: 56,
                cell: ({ row }) => {
                    const post = row.original;

                    return (
                        <div className="flex justify-end">
                            <RowActionsMenu
                                triggerLabel="Thao tác"
                                triggerClassName="size-9"
                                items={[
                                    ...(post.awaiting && can.publish
                                        ? [
                                              {
                                                  label: 'Đăng ngay',
                                                  icon: Send,
                                                  onSelect: () =>
                                                      publishNow(post),
                                              },
                                              {
                                                  label: 'Hẹn lại',
                                                  icon: CalendarClock,
                                                  onSelect: () =>
                                                      openReschedule(post),
                                              },
                                          ]
                                        : []),
                                    ...(can.publish
                                        ? post.targets
                                              .filter(
                                                  (target) => target.can_retry,
                                              )
                                              .map((target) => ({
                                                  label: `${
                                                      target.status ===
                                                      'unknown'
                                                          ? 'Đăng lại'
                                                          : 'Thử lại'
                                                  }: ${target.group ?? target.label}`,
                                                  icon: RotateCw,
                                                  disabled: busy,
                                                  onSelect: () =>
                                                      retryTarget(target),
                                              }))
                                        : []),
                                    ...(post.cancellable && can.publish
                                        ? [
                                              {
                                                  label: 'Dừng đăng',
                                                  icon: Square,
                                                  destructive: true,
                                                  onSelect: () =>
                                                      cancelPost(post),
                                              },
                                          ]
                                        : []),
                                    ...(can.create
                                        ? [
                                              {
                                                  label: 'Nhân bản',
                                                  icon: Copy,
                                                  disabled: busy,
                                                  onSelect: () =>
                                                      duplicatePost(post),
                                              },
                                          ]
                                        : []),
                                    ...(can.delete &&
                                    post.status !== 'publishing'
                                        ? [
                                              {
                                                  label: 'Xoá',
                                                  icon: Trash2,
                                                  destructive: true,
                                                  separatorBefore: true,
                                                  onSelect: () =>
                                                      removePost(post),
                                              },
                                          ]
                                        : []),
                                ]}
                            />
                        </div>
                    );
                },
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [can, busy, expanded],
    );

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
            <Head title="Bài viết" />

            <PlatformTabs
                value={filters.provider}
                onChange={(provider) => navigate({ provider })}
                allCount={counts.all}
                items={providers.map((provider) => ({
                    key: provider.key,
                    label: provider.label,
                    count: counts.providers[provider.key] ?? 0,
                    letter: provider.label.charAt(0),
                    color: '#64748b',
                }))}
            />

            <DataTable<PostRow, unknown>
                columns={columns}
                data={posts.data}
                searchPlaceholder="Tìm bài viết..."
                emptyMessage="Chưa có bài viết nào."
                onCreate={can.create ? createPost : undefined}
                onSearchChange={setSearch}
                toolbarActions={stateFilter}
                onDeleteSelected={can.delete ? deleteSelected : undefined}
                selectionResetKey={`${posts.current_page}:${posts.total}:${filters.provider}:${filters.state}`}
                pagination={{
                    pageIndex: posts.current_page - 1,
                    pageSize: posts.per_page,
                }}
                onPaginationChange={(next) =>
                    navigate({ page: next.pageIndex + 1 })
                }
                pageCount={posts.last_page}
                rowCount={posts.total}
            />

            <Dialog
                open={rescheduling !== null}
                onOpenChange={(open) => !open && setRescheduling(null)}
            >
                <DialogContent>
                    <form onSubmit={submitReschedule} className="grid gap-4">
                        <DialogHeader>
                            <DialogTitle>Hẹn lại giờ đăng</DialogTitle>
                            <DialogDescription>
                                Giờ theo múi giờ Asia/Ho_Chi_Minh (GMT+7).
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Input
                                type="date"
                                required
                                aria-label="Ngày đăng"
                                value={rescheduling?.date ?? ''}
                                onChange={(event) =>
                                    setRescheduling((current) =>
                                        current
                                            ? {
                                                  ...current,
                                                  date: event.target.value,
                                              }
                                            : current,
                                    )
                                }
                            />
                            <Input
                                type="time"
                                required
                                aria-label="Giờ đăng"
                                value={rescheduling?.time ?? ''}
                                onChange={(event) =>
                                    setRescheduling((current) =>
                                        current
                                            ? {
                                                  ...current,
                                                  time: event.target.value,
                                              }
                                            : current,
                                    )
                                }
                            />
                        </div>
                        <InputError message={rescheduleError} />
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setRescheduling(null)}
                            >
                                Huỷ
                            </Button>
                            <Button type="submit" disabled={busy}>
                                Hẹn lại
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
