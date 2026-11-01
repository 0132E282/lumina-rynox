import { Head, router, useForm, usePage } from '@inertiajs/react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
    retry,
    store,
    update,
} from '@/actions/App/Http/Controllers/PostController';
import InputError from '@/components/input-error';
import { AiDraft } from '@/components/posts/ai-draft';
import { GroupPicker } from '@/components/posts/group-picker';
import { MediaField } from '@/components/posts/media-field';
import { TargetName } from '@/components/posts/target-name';
import {
    TARGET_STATUS,
    shouldShowDeliveryError,
} from '@/components/posts/post-status';
import { PlatformLogo } from '@/components/social/platform-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useHeaderActions } from '@/contexts/header-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { formatDateTimePersonal } from '@/lib/personal-date';
import type {
    PostAudience,
    PostFormProps,
    PostMedia,
    PostProviderKey,
} from '@/types';

type PostAction = 'draft' | 'schedule' | 'publish_now' | 'save';

type Destination = 'profile' | 'groups';

// * Platforms whose saved groups can be posted to (mirrors the server's SocialGroupSync providers); each shows the "Đăng vào" choice even before any group is synced.
const GROUP_PROVIDERS: PostProviderKey[] = [
    'facebook_personal',
    'linkedin_personal',
];

type PostFormData = {
    action: PostAction;
    title: string;
    body: string;
    media: PostMedia[];
    targets: PostProviderKey[];
    audiences: Partial<Record<PostProviderKey, PostAudience>>;
    groups: Partial<Record<PostProviderKey, number[]>>;
    scheduled_date: string;
    scheduled_time: string;
};

const MAX_MEDIA = 10;

export default function PostForm({
    post,
    deliveries,
    providers,
    socialGroups,
    timezone,
    maxBodyLength,
    canPublish,
}: PostFormProps) {
    const canUseAi = Boolean(usePage().props.canUseAi);
    const [retryingId, setRetryingId] = useState<number | null>(null);

    // * Re-posts one failed platform only (same route and `posts.publish` permission as the list's "Thử lại").
    const retryDelivery = (targetId: number) => {
        setRetryingId(targetId);
        router.post(
            retry.url({ target: targetId }),
            {},
            {
                preserveScroll: true,
                onFinish: () => setRetryingId(null),
            },
        );
    };
    const form = useForm<PostFormData>({
        action: 'draft',
        title: post?.title ?? '',
        body: post?.body ?? '',
        media: post?.media ?? [],
        targets: post?.targets ?? [],
        audiences: post?.audiences ?? {},
        groups: post?.groups ?? {},
        scheduled_date: post?.scheduled_date ?? '',
        scheduled_time: post?.scheduled_time ?? '09:00',
    });

    // * Platforms and groups are chosen once, when the post is created; a post saved without any can still get them.
    const platformsLocked =
        post !== null &&
        (post.targets.length > 0 ||
            Object.values(post.groups).some((ids) => (ids ?? []).length > 0));
    // * Only drafts and scheduled posts can still change schedule; every other state edits the content alone.
    const contentOnly =
        post !== null && post.status !== 'draft' && post.status !== 'scheduled';

    const errors = form.errors as Record<string, string | undefined>;
    const errorOf = (key: string) => errors[key];
    const mediaError =
        errors.media ??
        Object.entries(errors).find(([key]) => key.startsWith('media.'))?.[1];

    // * Where a ticked platform posts: its own page/profile, or the saved groups. Derived once from the post, then driven by the choice.
    const [destination, setDestination] = useState<
        Partial<Record<PostProviderKey, Destination>>
    >(() => {
        const initial: Partial<Record<PostProviderKey, Destination>> = {};

        for (const key of Object.keys(form.data.groups) as PostProviderKey[]) {
            if ((form.data.groups[key] ?? []).length > 0) {
                initial[key] = 'groups';
            }
        }

        for (const key of form.data.targets) {
            initial[key] = 'profile';
        }

        return initial;
    });

    const [groupPickerOpen, setGroupPickerOpen] =
        useState<PostProviderKey | null>(null);

    // * One choice per platform: "profile" posts to the platform itself and clears groups; "groups" posts only to the ticked groups.
    const chooseDestination = (
        key: PostProviderKey,
        value: Destination | null,
    ) => {
        // * Switching to "Nhóm" opens the group popup right away.
        if (value === 'groups' && destination[key] !== 'groups') {
            setGroupPickerOpen(key);
        }

        setDestination((current) => {
            const next = { ...current };

            if (value === null) {
                delete next[key];
            } else {
                next[key] = value;
            }

            return next;
        });
        form.setData((data) => ({
            ...data,
            targets:
                value === 'profile'
                    ? [...data.targets.filter((target) => target !== key), key]
                    : data.targets.filter((target) => target !== key),
            groups:
                value === 'groups'
                    ? data.groups
                    : { ...data.groups, [key]: [] },
        }));
    };

    const toggleGroup = (
        key: PostProviderKey,
        id: number,
        checked: boolean,
    ) => {
        const current = form.data.groups[key] ?? [];

        form.setData('groups', {
            ...form.data.groups,
            [key]: checked
                ? [...current, id]
                : current.filter((groupId) => groupId !== id),
        });
    };

    // * Ticking a group of a platform that is not in "groups" mode switches it to groups (profile off).
    const pickGroup = (key: PostProviderKey, id: number, checked: boolean) => {
        if (destination[key] !== 'groups') {
            chooseDestination(key, 'groups');
            form.setData((data) => ({
                ...data,
                groups: { ...data.groups, [key]: checked ? [id] : [] },
            }));

            return;
        }

        toggleGroup(key, id, checked);
    };

    const submit = (action: PostAction) => {
        form.transform((data) => ({ ...data, action }));

        if (post) {
            form.put(update.url({ post: post.id }), { preserveScroll: true });
        } else {
            form.post(store.url(), { preserveScroll: true });
        }
    };

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        // * Enter inside a field only saves a draft (or the content of a sent post); scheduling or publishing needs its own button.
        submit(contentOnly ? 'save' : 'draft');
    };

    // * The buttons live in the admin header, which renders outside this page: they call the latest submit through a ref instead of a stale closure.
    const submitRef = useRef(submit);
    submitRef.current = submit;

    useHeaderActions(
        <>
            {contentOnly ? (
                <Button
                    type="button"
                    size="sm"
                    disabled={form.processing}
                    onClick={() => submitRef.current('save')}
                >
                    Lưu nội dung
                </Button>
            ) : (
                <>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={form.processing}
                        onClick={() => submitRef.current('draft')}
                    >
                        Lưu nháp
                    </Button>
                    {canPublish && (
                        <>
                            <Button
                                type="button"
                                size="sm"
                                disabled={form.processing}
                                onClick={() => submitRef.current('schedule')}
                            >
                                Hẹn giờ đăng
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={form.processing}
                                onClick={() => submitRef.current('publish_now')}
                            >
                                Đăng ngay
                            </Button>
                        </>
                    )}
                </>
            )}
        </>,
        [form.processing, contentOnly, canPublish],
    );

    return (
        <div className="grid min-w-0 flex-1 gap-6 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Head title={post ? 'Sửa bài viết' : 'Thêm bài viết'} />

            <form
                onSubmit={handleSubmit}
                className="grid min-w-0 content-start gap-6"
            >
                <Card>
                    <CardHeader className="gap-0 border-b [.border-b]:pb-3">
                        <CardTitle>Nội dung</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="post-title">
                                Tiêu đề (không bắt buộc)
                            </Label>
                            <Input
                                id="post-title"
                                value={form.data.title}
                                maxLength={255}
                                onChange={(event) =>
                                    form.setData('title', event.target.value)
                                }
                                aria-invalid={!!errorOf('title')}
                            />
                            <InputError message={errorOf('title')} />
                        </div>
                        <div className="grid gap-2">
                            <Label>Ảnh hoặc video</Label>
                            <MediaField
                                value={form.data.media}
                                onChange={(media) =>
                                    form.setData('media', media)
                                }
                                max={MAX_MEDIA}
                                disabled={form.processing}
                            />
                            <InputError message={mediaError} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="post-body">Nội dung bài viết</Label>
                            {canUseAi && (
                                <AiDraft
                                    disabled={form.processing}
                                    onDraft={(draft) =>
                                        form.setData((data) => ({
                                            ...data,
                                            title: draft.title ?? data.title,
                                            body: draft.body.slice(
                                                0,
                                                maxBodyLength,
                                            ),
                                        }))
                                    }
                                />
                            )}
                            <textarea
                                id="post-body"
                                value={form.data.body}
                                maxLength={maxBodyLength}
                                rows={7}
                                onChange={(event) =>
                                    form.setData('body', event.target.value)
                                }
                                aria-invalid={!!errorOf('body')}
                                className="min-h-32 w-full rounded-sm border border-input bg-card px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
                            />
                            <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                                <span>
                                    Dùng chung cho mọi nền tảng, mỗi nền tảng có
                                    giới hạn ký tự riêng ở phần xem trước.
                                </span>
                                <span>
                                    {form.data.body.length} / {maxBodyLength}
                                </span>
                            </div>
                            <InputError message={errorOf('body')} />
                        </div>
                    </CardContent>
                </Card>

                {/* * Platforms are chosen only when the post is created, so the card is hidden for a post that already has them. */}
                {!platformsLocked && (
                    <Card>
                        <CardHeader className="gap-0 border-b [.border-b]:pb-3">
                            <CardTitle>Đăng lên</CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-3">
                            {!platformsLocked &&
                                providers.map((provider) => {
                                    const id = `post-target-${provider.key}`;
                                    const mode = destination[provider.key];
                                    const checked = mode !== undefined;

                                    // * Each platform declares its own audiences; the first is the default.
                                    const audience =
                                        form.data.audiences[provider.key] ??
                                        provider.audiences[0]?.value;

                                    const groups = socialGroups.filter(
                                        (group) =>
                                            group.provider === provider.key,
                                    );

                                    return (
                                        <div
                                            key={provider.key}
                                            className="rounded-md border p-3 aria-disabled:opacity-60"
                                            aria-disabled={!provider.selectable}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Checkbox
                                                    id={id}
                                                    checked={checked}
                                                    disabled={
                                                        !provider.selectable &&
                                                        !checked
                                                    }
                                                    onCheckedChange={(value) =>
                                                        chooseDestination(
                                                            provider.key,
                                                            value === true
                                                                ? 'profile'
                                                                : null,
                                                        )
                                                    }
                                                />
                                                <PlatformLogo
                                                    provider={provider.key}
                                                    letter={provider.letter}
                                                    color={provider.color}
                                                />
                                                <Label
                                                    htmlFor={id}
                                                    className="flex flex-1 flex-col items-start gap-0.5 font-normal"
                                                >
                                                    <span className="font-medium">
                                                        {provider.label}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {provider.selectable
                                                            ? provider.account
                                                            : provider.reason}
                                                    </span>
                                                </Label>
                                                {checked &&
                                                    GROUP_PROVIDERS.includes(
                                                        provider.key,
                                                    ) && (
                                                        <Select
                                                            value={mode}
                                                            onValueChange={(
                                                                value,
                                                            ) =>
                                                                chooseDestination(
                                                                    provider.key,
                                                                    value as Destination,
                                                                )
                                                            }
                                                        >
                                                            <SelectTrigger
                                                                aria-label="Đăng vào"
                                                                className="w-40"
                                                            >
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="profile">
                                                                    Trang cá
                                                                    nhân
                                                                </SelectItem>
                                                                <SelectItem value="groups">
                                                                    Nhóm
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    )}
                                            </div>
                                            <div className="mt-3 flex flex-wrap items-start gap-4 empty:hidden">
                                                {mode === 'profile' &&
                                                    provider.audiences.length >
                                                        0 && (
                                                        <div className="grid min-w-56 flex-1 gap-2">
                                                            <Label
                                                                htmlFor={`${id}-audience`}
                                                            >
                                                                Đối tượng
                                                            </Label>
                                                            <Select
                                                                value={audience}
                                                                onValueChange={(
                                                                    value,
                                                                ) =>
                                                                    form.setData(
                                                                        'audiences',
                                                                        {
                                                                            ...form
                                                                                .data
                                                                                .audiences,
                                                                            [provider.key]:
                                                                                value as PostAudience,
                                                                        },
                                                                    )
                                                                }
                                                            >
                                                                <SelectTrigger
                                                                    id={`${id}-audience`}
                                                                    className="w-full"
                                                                >
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {provider.audiences.map(
                                                                        (
                                                                            option,
                                                                        ) => (
                                                                            <SelectItem
                                                                                key={
                                                                                    option.value
                                                                                }
                                                                                value={
                                                                                    option.value
                                                                                }
                                                                            >
                                                                                {
                                                                                    option.label
                                                                                }
                                                                            </SelectItem>
                                                                        ),
                                                                    )}
                                                                </SelectContent>
                                                            </Select>
                                                            {audience ===
                                                                'public' && (
                                                                <p className="text-xs text-muted-foreground">
                                                                    Bài viết sẽ
                                                                    hiển thị với
                                                                    tất cả mọi
                                                                    người.
                                                                </p>
                                                            )}
                                                            <InputError
                                                                message={errorOf(
                                                                    `audiences.${provider.key}`,
                                                                )}
                                                            />
                                                        </div>
                                                    )}
                                            </div>
                                            {mode === 'groups' && (
                                                <div className="mt-3">
                                                    <GroupPicker
                                                        open={
                                                            groupPickerOpen ===
                                                            provider.key
                                                        }
                                                        onOpenChange={(next) =>
                                                            setGroupPickerOpen(
                                                                next
                                                                    ? provider.key
                                                                    : null,
                                                            )
                                                        }
                                                        providers={[provider]}
                                                        groups={groups}
                                                        selected={
                                                            form.data.groups
                                                        }
                                                        onToggle={pickGroup}
                                                        errorOf={errorOf}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                            <InputError message={errorOf('targets')} />
                            <InputError message={errorOf('groups')} />
                        </CardContent>
                    </Card>
                )}

                <InputError message={errorOf('action')} />
            </form>

            <aside
                aria-label="Thông tin bài viết"
                className="grid min-w-0 content-start gap-6"
            >
                {/* * A post that already has targets lists where it went and how each one ended. */}
                {platformsLocked && deliveries.length > 0 && (
                    <Card>
                        <CardHeader className="gap-0 border-b [.border-b]:pb-3">
                            <CardTitle>Nơi đã đăng</CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-3">
                            {deliveries.map((delivery) => {
                                const state = TARGET_STATUS[delivery.status];
                                const StateIcon = state.icon;

                                return (
                                    <div
                                        key={delivery.id}
                                        className="flex items-center gap-3"
                                    >
                                        <PlatformLogo
                                            provider={delivery.provider}
                                            letter={delivery.letter}
                                            color={delivery.color}
                                            className="size-7"
                                        />
                                        <div className="grid min-w-0 flex-1 gap-0.5">
                                            <div className="flex min-w-0 items-center gap-2 text-sm">
                                                <TargetName target={delivery} />
                                            </div>
                                            {delivery.published_at && (
                                                <p className="text-xs text-muted-foreground">
                                                    {formatDateTimePersonal(
                                                        delivery.published_at,
                                                    )}
                                                </p>
                                            )}
                                            {shouldShowDeliveryError(
                                                delivery.error,
                                            ) && (
                                                <p className="text-xs text-muted-foreground">
                                                    {delivery.error}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                                            <span
                                                className={`flex items-center gap-1 text-xs ${state.className}`}
                                            >
                                                <StateIcon
                                                    aria-hidden="true"
                                                    className="size-3"
                                                />
                                                {delivery.status_label}
                                            </span>
                                            {canPublish &&
                                                delivery.status ===
                                                    'failed' && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={
                                                            retryingId !== null
                                                        }
                                                        aria-busy={
                                                            retryingId ===
                                                            delivery.id
                                                        }
                                                        onClick={() =>
                                                            retryDelivery(
                                                                delivery.id,
                                                            )
                                                        }
                                                    >
                                                        Đăng lại
                                                    </Button>
                                                )}
                                        </div>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                )}
                {post === null && (
                    <Card>
                        <CardHeader className="gap-0 border-b [.border-b]:pb-3">
                            <CardTitle>Lịch đăng</CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-4">
                            <div className="grid gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="post-date">Ngày đăng</Label>
                                    <Input
                                        id="post-date"
                                        type="date"
                                        value={form.data.scheduled_date}
                                        onChange={(event) =>
                                            form.setData(
                                                'scheduled_date',
                                                event.target.value,
                                            )
                                        }
                                        aria-invalid={
                                            !!errorOf('scheduled_date')
                                        }
                                    />
                                    <InputError
                                        message={errorOf('scheduled_date')}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="post-time">Giờ đăng</Label>
                                    <Input
                                        id="post-time"
                                        type="time"
                                        value={form.data.scheduled_time}
                                        onChange={(event) =>
                                            form.setData(
                                                'scheduled_time',
                                                event.target.value,
                                            )
                                        }
                                        aria-invalid={
                                            !!errorOf('scheduled_time')
                                        }
                                    />
                                    <InputError
                                        message={errorOf('scheduled_time')}
                                    />
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="post-zone">Múi giờ</Label>
                                <Input
                                    id="post-zone"
                                    value={`${timezone.name} (${timezone.label})`}
                                    readOnly
                                />
                                <p className="text-xs text-muted-foreground">
                                    Bài được đăng tự động đúng giờ trên từng nền
                                    tảng đã chọn. Bài lỡ lịch hơn 1 giờ không tự
                                    đăng mà chờ bạn xác nhận.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </aside>
        </div>
    );
}
