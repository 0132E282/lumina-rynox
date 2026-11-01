import { Head, router } from '@inertiajs/react';
import { isAxiosError } from 'axios';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { sync } from '@/actions/App/Http/Controllers/SocialGroupController';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PlatformLogo } from '@/components/social/platform-logo';
import { PlatformTabs } from '@/components/social/platform-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useDebounce } from '@/hooks/use-debounce';
import { useInitials } from '@/hooks/use-initials';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

type SocialGroupRow = {
    id: number;
    provider: string;
    external_id: string;
    name: string;
    url: string;
    image_url: string | null;
    synced_at: string;
    left_at: string | null;
};

type Provider = {
    key: string;
    name: string;
    letter: string;
    color: string;
};

type GroupPagination = {
    data: SocialGroupRow[];
    current_page: number;
    last_page: number;
    total: number;
    from: number | null;
    to: number | null;
};

const ALL_STATES = 'all';
const SYNC_ERROR = 'Không đồng bộ được nhóm, hãy thử lại sau.';
const THROTTLED_ERROR = 'Bạn đồng bộ quá nhiều lần, hãy thử lại sau ít phút.';

export default function SocialGroupsIndex({
    groups,
    filters,
    counts,
    providers,
    canSync,
}: {
    groups: GroupPagination;
    filters: { provider: string | null; q: string; state: string | null };
    counts: Record<string, number>;
    providers: Provider[];
    canSync: boolean;
}) {
    const getInitials = useInitials();
    const [search, setSearch] = useState(filters.q);
    const debouncedSearch = useDebounce(search, 300);
    const [working, setWorking] = useState<string | null>(null);
    const byKey = Object.fromEntries(
        providers.map((provider) => [provider.key, provider]),
    );

    const filtersRef = useRef(filters);
    filtersRef.current = filters;

    const navigate = (
        next: Partial<{
            provider: string | null;
            q: string;
            state: string | null;
            page: number;
        }>,
    ) => {
        const merged = { ...filtersRef.current, ...next };

        router.get(
            '/social-groups',
            {
                ...(merged.provider ? { provider: merged.provider } : {}),
                ...(merged.q !== '' ? { q: merged.q } : {}),
                ...(merged.state ? { state: merged.state } : {}),
                ...(next.page && next.page > 1 ? { page: next.page } : {}),
            },
            { preserveState: true, preserveScroll: true, replace: true },
        );
    };
    const goToPage = (page: number) => navigate({ page });

    // * The search runs after a short pause; filtersRef keeps it from navigating with a stale platform.
    useEffect(() => {
        if (debouncedSearch !== filtersRef.current.q) {
            navigate({ q: debouncedSearch });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch]);

    const run = async (provider: Provider) => {
        if (working !== null) {
            return;
        }

        setWorking(provider.key);

        try {
            const { data } = await api.post<{ synced: number }>(
                sync.url(provider.key),
            );

            toast.success(`${provider.name}: đã đồng bộ ${data.synced} nhóm.`);
            router.reload({ only: ['groups'] });
        } catch (failure) {
            toast.error(
                isAxiosError<{ message?: string }>(failure)
                    ? failure.response?.status === 429
                        ? THROTTLED_ERROR
                        : (failure.response?.data?.message ?? SYNC_ERROR)
                    : SYNC_ERROR,
            );
        } finally {
            setWorking(null);
        }
    };

    return (
        <>
            <Head title="Nhóm mạng xã hội" />
            <div className="flex flex-col gap-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h1 className="text-lg font-semibold">Nhóm mạng xã hội</h1>
                    {canSync ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={working !== null}
                                >
                                    <RefreshCw
                                        aria-hidden="true"
                                        className={
                                            working !== null
                                                ? 'animate-spin'
                                                : undefined
                                        }
                                    />
                                    {working !== null
                                        ? 'Đang đồng bộ...'
                                        : 'Đồng bộ'}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {providers.map((provider) => (
                                    <DropdownMenuItem
                                        key={provider.key}
                                        onSelect={() => run(provider)}
                                    >
                                        Đồng bộ {provider.name}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : null}
                </div>

                <PlatformTabs
                    value={filters.provider}
                    onChange={(provider) => navigate({ provider })}
                    allCount={counts.all ?? 0}
                    items={providers.map((provider) => ({
                        key: provider.key,
                        label: provider.name,
                        count: counts[provider.key] ?? 0,
                        letter: provider.letter,
                        color: provider.color,
                    }))}
                />

                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-60 flex-1">
                        <Search
                            aria-hidden="true"
                            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Tìm tên hoặc ID nhóm..."
                            aria-label="Tìm nhóm"
                            maxLength={100}
                            className="pl-9"
                        />
                    </div>
                    <Select
                        value={filters.state ?? ALL_STATES}
                        onValueChange={(value) =>
                            navigate({
                                state: value === ALL_STATES ? null : value,
                            })
                        }
                    >
                        <SelectTrigger aria-label="Lọc theo trạng thái nhóm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_STATES}>
                                Trạng thái: Tất cả
                            </SelectItem>
                            <SelectItem value="active">Còn tham gia</SelectItem>
                            <SelectItem value="left">Đã rời</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nhóm</TableHead>
                                <TableHead>ID</TableHead>
                                <TableHead>Link</TableHead>
                                <TableHead>Nền tảng</TableHead>
                                <TableHead>Đồng bộ lúc</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {groups.data.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={5}
                                        className="py-8 text-center text-muted-foreground"
                                    >
                                        Chưa có nhóm nào, bấm Đồng bộ để đọc từ
                                        tài khoản.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                groups.data.map((group) => (
                                    <TableRow key={group.id}>
                                        <TableCell>
                                            <span className="flex items-center gap-3">
                                                <Avatar className="size-9 rounded-md">
                                                    <AvatarImage
                                                        src={
                                                            group.image_url ??
                                                            undefined
                                                        }
                                                        alt=""
                                                        loading="lazy"
                                                        referrerPolicy="no-referrer"
                                                    />
                                                    <AvatarFallback
                                                        aria-hidden="true"
                                                        className="rounded-md"
                                                    >
                                                        {getInitials(
                                                            group.name,
                                                        )}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <span
                                                    className={
                                                        group.left_at
                                                            ? 'font-medium text-muted-foreground'
                                                            : 'font-medium'
                                                    }
                                                >
                                                    {group.name}
                                                </span>
                                                {group.left_at && (
                                                    <Badge
                                                        variant="secondary"
                                                        title={`Không còn thấy từ ${formatDateTime(group.left_at)}`}
                                                    >
                                                        Đã rời
                                                    </Badge>
                                                )}
                                            </span>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {group.external_id}
                                        </TableCell>
                                        <TableCell>
                                            <a
                                                href={group.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary hover:underline"
                                            >
                                                Mở nhóm
                                            </a>
                                        </TableCell>
                                        <TableCell>
                                            <span className="flex items-center gap-2">
                                                <PlatformLogo
                                                    provider={group.provider}
                                                    letter={
                                                        byKey[group.provider]
                                                            ?.letter ?? '?'
                                                    }
                                                    color={
                                                        byKey[group.provider]
                                                            ?.color ?? '#64748b'
                                                    }
                                                />
                                                {byKey[group.provider]?.name ??
                                                    group.provider}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {formatDateTime(group.synced_at)}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>
                        {groups.total === 0
                            ? 'Không có nhóm'
                            : `Hiển thị ${groups.from}-${groups.to} trên ${groups.total} nhóm`}
                    </span>
                    {groups.last_page > 1 && (
                        <div className="flex items-center gap-1">
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label="Trang trước"
                                disabled={groups.current_page <= 1}
                                onClick={() =>
                                    goToPage(groups.current_page - 1)
                                }
                            >
                                <ChevronLeft className="size-4" />
                            </Button>
                            <span className="px-2">
                                {groups.current_page} / {groups.last_page}
                            </span>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label="Trang sau"
                                disabled={
                                    groups.current_page >= groups.last_page
                                }
                                onClick={() =>
                                    goToPage(groups.current_page + 1)
                                }
                            >
                                <ChevronRight className="size-4" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
