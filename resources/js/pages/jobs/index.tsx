import { Head, Link, router } from '@inertiajs/react';
import {
    ChevronLeft,
    ChevronRight,
    Clock,
    Filter,
    Search,
    Sparkles,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
    crawl,
    index,
    show,
    updateStatus,
} from '@/actions/App/Http/Controllers/JobPostingController';
import { PlatformLogo } from '@/components/posts/platform-logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useHeaderActions } from '@/contexts/header-actions';
import { useDebounce } from '@/hooks/use-debounce';
import { crawlStatusLine, emailStatusLine } from '@/lib/job-source';
import { formatDateTimePersonal } from '@/lib/personal-date';
import type {
    JobApplicationStatus,
    JobRow,
    JobSource,
    JobsIndexProps,
} from '@/types';

const ALL_SOURCES = 'all';

const APPLICATION_STATUS_LABELS: Record<JobApplicationStatus, string> = {
    new: 'Mới',
    saved: 'Đã lưu',
    skipped: 'Đã bỏ qua',
    approved: 'Đã duyệt',
    applied: 'Đã nộp',
};

function SourceCell({ job, sources }: { job: JobRow; sources: JobSource[] }) {
    const source = sources.find((entry) => entry.key === job.source);

    return (
        <span className="flex items-center gap-2 text-sm font-medium">
            <PlatformLogo
                letter={source?.letter ?? job.source[0].toUpperCase()}
                color={source?.color ?? '#71717a'}
            />
            {source?.name ?? job.source}
            {job.via === 'email' && <Badge variant="outline">Email</Badge>}
        </span>
    );
}

function ApplicationCell({
    job,
    canUpdate,
}: {
    job: JobRow;
    canUpdate: boolean;
}) {
    const [note, setNote] = useState(job.note ?? '');
    const [busy, setBusy] = useState(false);
    const status = job.application_status;

    const submit = (next: JobApplicationStatus, nextNote = note) => {
        setBusy(true);
        router.patch(
            updateStatus.url(job.id),
            { status: next, note: nextNote },
            { preserveScroll: true, onFinish: () => setBusy(false) },
        );
    };

    // * Only opens the public listing in the user's own browser tab; the app sends nothing to the job site.
    const approveAndOpen = () => {
        if (/^https?:\/\//i.test(job.url)) {
            window.open(job.url, '_blank', 'noopener,noreferrer');
        }

        submit('approved');
    };

    return (
        <div className="flex min-w-64 flex-col gap-2">
            <Badge
                variant={status === 'applied' ? 'default' : 'secondary'}
                className="w-fit"
            >
                {APPLICATION_STATUS_LABELS[status]}
            </Badge>
            {status === 'applied' && job.applied_at && (
                <span className="text-xs text-muted-foreground">
                    Nộp lúc {formatDateTimePersonal(job.applied_at)}
                </span>
            )}
            {canUpdate && (
                <>
                    <div className="flex flex-wrap gap-1">
                        {(status === 'new' || status === 'skipped') && (
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => submit('saved')}
                            >
                                Lưu
                            </Button>
                        )}
                        {(status === 'new' || status === 'saved') && (
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => submit('skipped')}
                            >
                                Bỏ qua
                            </Button>
                        )}
                        {status !== 'applied' &&
                            status !== 'approved' &&
                            status !== 'skipped' && (
                                <Button
                                    size="sm"
                                    disabled={busy}
                                    onClick={approveAndOpen}
                                >
                                    Duyệt &amp; mở trang ứng tuyển
                                </Button>
                            )}
                        {status === 'approved' && (
                            <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => submit('applied')}
                            >
                                Đánh dấu đã nộp
                            </Button>
                        )}
                    </div>
                    <Input
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        onBlur={() => {
                            if (note !== (job.note ?? '')) {
                                submit(status, note);
                            }
                        }}
                        placeholder="Ghi chú..."
                        aria-label="Ghi chú"
                        maxLength={1000}
                    />
                </>
            )}
            {!canUpdate && job.note && (
                <p className="text-xs text-muted-foreground">{job.note}</p>
            )}
        </div>
    );
}

export default function JobsIndex({
    jobs,
    filters,
    sources,
    summary,
    can,
}: JobsIndexProps) {
    const [search, setSearch] = useState(filters.q);
    const debouncedSearch = useDebounce(search, 300);
    const [crawling, setCrawling] = useState(false);
    // * Latest filters for the debounced search effect, so it never navigates with a stale source tab.
    const filtersRef = useRef(filters);
    filtersRef.current = filters;

    const crawlNow = () => {
        setCrawling(true);
        router.post(
            crawl.url(),
            {},
            { preserveScroll: true, onFinish: () => setCrawling(false) },
        );
    };

    useHeaderActions(
        can.update ? (
            <Button size="sm" disabled={crawling} onClick={crawlNow}>
                <Search className="size-4" />
                {crawling ? 'Đang tìm...' : 'Tìm việc ngay'}
            </Button>
        ) : null,
        [can.update, crawling],
    );

    const navigate = (
        next: Partial<{
            source: string | null;
            q: string;
            status: string | null;
            page: number;
        }>,
    ) => {
        const merged = { ...filtersRef.current, ...next };

        router.get(
            index.url({
                query: {
                    ...(merged.source ? { source: merged.source } : {}),
                    ...(merged.status ? { status: merged.status } : {}),
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

    const cards: {
        label: string;
        value: number;
        icon: ComponentType<{ className?: string }>;
    }[] = [
        { label: 'Tất cả việc làm', value: summary.total, icon: Filter },
        { label: 'Mới trong 24 giờ', value: summary.new_24h, icon: Sparkles },
        ...sources.map((source) => ({
            label: source.name,
            value: summary.by_source[source.key],
            icon: Clock,
        })),
    ];

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
            <Head title="Việc làm" />

            <Card className="py-4">
                <CardContent className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 font-semibold">
                        <Filter className="size-4" aria-hidden="true" />
                        Tự lọc việc làm phù hợp
                    </div>
                    <ul className="flex flex-col gap-2">
                        {sources.map((source) => (
                            <li
                                key={source.key}
                                className="flex flex-wrap items-center gap-2 text-sm"
                            >
                                <PlatformLogo
                                    letter={source.letter}
                                    color={source.color}
                                />
                                <span className="font-medium">
                                    {source.name}
                                </span>
                                {source.crawl && (
                                    <Badge variant="outline">
                                        {source.enabled
                                            ? 'Đang bật'
                                            : 'Đang tắt'}
                                    </Badge>
                                )}
                                {source.crawl && (
                                    <span className="text-xs text-muted-foreground">
                                        {crawlStatusLine(source)}
                                    </span>
                                )}
                                {source.email && (
                                    <span className="text-xs text-muted-foreground">
                                        {emailStatusLine(source)}
                                    </span>
                                )}
                                {source.crawl &&
                                    source.last_status &&
                                    source.last_status !== 'ok' &&
                                    source.last_message && (
                                        <span className="text-xs text-muted-foreground">
                                            {source.last_message}
                                        </span>
                                    )}
                            </li>
                        ))}
                    </ul>
                </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {cards.map(({ label, value, icon: Icon }) => (
                    <Card key={label} className="gap-2 py-4">
                        <CardContent className="flex flex-col gap-1">
                            <span className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Icon className="size-4" aria-hidden="true" />
                                {label}
                            </span>
                            <span className="text-2xl font-bold">{value}</span>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Tabs
                value={filters.source ?? ALL_SOURCES}
                onValueChange={(value) =>
                    navigate({ source: value === ALL_SOURCES ? null : value })
                }
            >
                <TabsList>
                    <TabsTrigger value={ALL_SOURCES}>Tất cả</TabsTrigger>
                    {sources.map((source) => (
                        <TabsTrigger key={source.key} value={source.key}>
                            {source.name}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>

            <Tabs
                value={filters.status ?? ALL_SOURCES}
                onValueChange={(value) =>
                    navigate({ status: value === ALL_SOURCES ? null : value })
                }
            >
                <TabsList>
                    <TabsTrigger value={ALL_SOURCES}>
                        Mọi trạng thái
                    </TabsTrigger>
                    {Object.entries(APPLICATION_STATUS_LABELS).map(
                        ([value, label]) => (
                            <TabsTrigger key={value} value={value}>
                                {label}
                            </TabsTrigger>
                        ),
                    )}
                </TabsList>
            </Tabs>

            <div className="relative min-w-60">
                <Search
                    aria-hidden="true"
                    className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Tìm theo vị trí, công ty, kỹ năng..."
                    aria-label="Tìm việc làm"
                    maxLength={100}
                    className="pl-9"
                />
            </div>

            <div className="rounded-lg border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Vị trí</TableHead>
                            <TableHead>Nguồn</TableHead>
                            <TableHead>Đăng</TableHead>
                            <TableHead>Ứng tuyển</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {jobs.data.length === 0 && (
                            <TableRow>
                                <TableCell
                                    colSpan={4}
                                    className="h-24 text-center text-muted-foreground"
                                >
                                    Chưa có việc làm nào. Nhập tiêu chí ở trang
                                    Tích hợp rồi bấm &quot;Tìm việc ngay&quot;.
                                </TableCell>
                            </TableRow>
                        )}
                        {jobs.data.map((job) => (
                            <TableRow key={job.id} className="align-top">
                                <TableCell className="max-w-xl whitespace-normal">
                                    <Link
                                        href={show.url(job.id)}
                                        className="font-medium text-blue-600 dark:text-blue-400"
                                    >
                                        {job.title}
                                    </Link>
                                    {job.match_score !== null && (
                                        <Badge
                                            className="ml-2"
                                            variant={
                                                job.match_score >= 70
                                                    ? 'default'
                                                    : 'secondary'
                                            }
                                        >
                                            Phù hợp {job.match_score}%
                                        </Badge>
                                    )}
                                    <p className="truncate text-xs text-muted-foreground">
                                        {[
                                            job.company,
                                            job.location,
                                            job.salary_text,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </p>
                                    {job.tags.length > 0 && (
                                        <p className="mt-1 flex flex-wrap gap-1">
                                            {job.tags.map((tag) => (
                                                <Badge
                                                    key={tag}
                                                    variant="secondary"
                                                >
                                                    {tag}
                                                </Badge>
                                            ))}
                                        </p>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <SourceCell job={job} sources={sources} />
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                    {formatDateTimePersonal(
                                        job.posted_at ?? job.first_seen_at,
                                    )}
                                    {!job.posted_at && (
                                        <div className="text-xs text-muted-foreground">
                                            Ngày phát hiện
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <ApplicationCell
                                        job={job}
                                        canUpdate={can.update}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>
                    {jobs.total === 0
                        ? 'Không có việc làm'
                        : `Hiển thị ${jobs.from}-${jobs.to} trên ${jobs.total} việc làm`}
                </span>
                {jobs.last_page > 1 && (
                    <div className="flex items-center gap-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Trang trước"
                            disabled={jobs.current_page <= 1}
                            onClick={() =>
                                navigate({ page: jobs.current_page - 1 })
                            }
                        >
                            <ChevronLeft className="size-4" />
                        </Button>
                        <span className="px-2">
                            {jobs.current_page} / {jobs.last_page}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Trang sau"
                            disabled={jobs.current_page >= jobs.last_page}
                            onClick={() =>
                                navigate({ page: jobs.current_page + 1 })
                            }
                        >
                            <ChevronRight className="size-4" />
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
