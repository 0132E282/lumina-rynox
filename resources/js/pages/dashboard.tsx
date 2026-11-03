import { Deferred, Head, Link } from '@inertiajs/react';
import {
    Activity,
    ArrowUpRight,
    Clock3,
    AlertCircle,
    CalendarClock,
    Eye,
    FolderOpen,
    MessageSquare,
    Settings2,
    ShieldCheck,
    Users,
    UsersRound,
} from 'lucide-react';
import { Suspense, lazy } from 'react';
import { PersonalSummary } from '@/components/dashboard/personal-summary';
import type { PersonalSummaryProps } from '@/components/dashboard/personal-summary';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const TrafficChart = lazy(() => import('@/components/dashboard/traffic-chart'));

interface AnalyticsDashboard {
    summary: {
        uniqueVisitors: number;
        pageViews: number;
        bounceRate: number;
        averageSessionDuration: number;
    };
    trend: Array<{
        date: string;
        visitors: number;
        pageViews: number;
    }>;
    sources: Array<{ name: string; sessions: number }>;
    pages: Array<{ name: string; views: number }>;
    devices: Array<{ name: string; sessions: number }>;
}

interface OverviewCard {
    key: 'unread' | 'scheduled' | 'failed' | 'groups';
    label: string;
    value: number;
    href: string;
}

interface DashboardProps extends Partial<PersonalSummaryProps> {
    overview?: OverviewCard[];
    stats: {
        admins: number;
        roles: number;
        files: number;
    };
    analytics?: AnalyticsDashboard | null;
    analyticsError?: boolean;
}

const cmsSections = [
    {
        key: 'admins',
        label: 'Quản trị viên',
        href: '/admins',
        icon: Users,
    },
    {
        key: 'roles',
        label: 'Vai trò & phân quyền',
        href: '/roles',
        icon: ShieldCheck,
    },
    {
        key: 'files',
        label: 'Thư viện tệp',
        href: '/file-manager',
        icon: FolderOpen,
    },
] as const;

const overviewIcons = {
    unread: MessageSquare,
    scheduled: CalendarClock,
    failed: AlertCircle,
    groups: UsersRound,
} as const;

const numberFormat = new Intl.NumberFormat('vi-VN');

function formatDuration(duration: number): string {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);

    return minutes > 0 ? `${minutes} phút ${seconds} giây` : `${seconds} giây`;
}

function BreakdownCard({
    title,
    description,
    rows,
    valueLabel,
    formatValue,
}: {
    title: string;
    description: string;
    rows: Array<{ name: string; value: number }>;
    valueLabel: string;
    formatValue: (value: number) => string;
}) {
    const maxValue = Math.max(...rows.map((row) => row.value), 1);

    return (
        <Card className="min-w-0 shadow-none">
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                {rows.length > 0 ? (
                    <div className="space-y-4">
                        {rows.map((row) => (
                            <div key={row.name} className="space-y-1.5">
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span
                                        className="min-w-0 truncate"
                                        title={row.name}
                                    >
                                        {row.name || '(not set)'}
                                    </span>
                                    <span className="shrink-0 font-medium tabular-nums">
                                        {formatValue(row.value)}
                                    </span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                        className="h-full rounded-full bg-primary"
                                        style={{
                                            width: `${Math.max((row.value / maxValue) * 100, 3)}%`,
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        Chưa có dữ liệu trong khoảng thời gian này.
                    </p>
                )}
                <p className="mt-4 text-xs text-muted-foreground">
                    {valueLabel}
                </p>
            </CardContent>
        </Card>
    );
}

function AnalyticsSkeleton() {
    return (
        <div aria-busy="true" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-24 w-full" />
                ))}
            </div>
            <Skeleton className="h-96 w-full" />
        </div>
    );
}

export default function Dashboard({
    stats,
    overview = [],
    analytics,
    analyticsError,
    personalModules = [],
    tasksSummary,
}: DashboardProps) {
    const analyticsCards = analytics
        ? [
              {
                  label: 'Khách truy cập',
                  value: numberFormat.format(analytics.summary.uniqueVisitors),
                  icon: Users,
              },
              {
                  label: 'Lượt xem trang',
                  value: numberFormat.format(analytics.summary.pageViews),
                  icon: Eye,
              },
              {
                  label: 'Tỷ lệ thoát',
                  value: `${analytics.summary.bounceRate.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`,
                  icon: Activity,
              },
              {
                  label: 'Thời lượng phiên',
                  value: formatDuration(
                      analytics.summary.averageSessionDuration,
                  ),
                  icon: Clock3,
              },
          ]
        : [];

    return (
        <main className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
            <Head title="Tổng quan" />

            {overview.length > 0 && (
                <section aria-label="Tổng quan nhanh">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {overview.map(({ key, label, value, href }) => {
                            const Icon = overviewIcons[key];

                            return (
                                <Link
                                    key={key}
                                    href={href}
                                    className="group rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                >
                                    <Card className="h-full shadow-none transition-colors hover:bg-muted/40">
                                        <CardContent className="flex items-start justify-between gap-3 p-4">
                                            <div className="min-w-0">
                                                <p className="text-sm text-muted-foreground">
                                                    {label}
                                                </p>
                                                <p
                                                    className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${key === 'failed' && value > 0 ? 'text-destructive' : value === 0 ? 'text-muted-foreground' : ''}`}
                                                >
                                                    {numberFormat.format(value)}
                                                </p>
                                            </div>
                                            <Icon
                                                aria-hidden="true"
                                                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                                            />
                                        </CardContent>
                                    </Card>
                                </Link>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* * Tasks sit beside the shortcuts (one column of short rows), so the row has no empty half. */}
            <div
                className={
                    personalModules.length > 0
                        ? 'grid items-start gap-4 lg:grid-cols-3'
                        : ''
                }
            >
                {personalModules.length > 0 && (
                    <div className="min-w-0 lg:col-span-2">
                        <PersonalSummary
                            personalModules={personalModules}
                            tasksSummary={tasksSummary}
                        />
                    </div>
                )}

                <section
                    aria-label="Lối tắt quản trị"
                    className={
                        personalModules.length > 0
                            ? 'flex flex-col gap-3'
                            : 'grid grid-cols-1 gap-3 sm:grid-cols-3'
                    }
                >
                    {cmsSections.map(({ key, label, href, icon: Icon }) => (
                        <Link
                            key={key}
                            href={href}
                            className="group rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                            <Card className="h-full shadow-none transition-colors hover:bg-muted/40">
                                <CardContent className="flex items-center justify-between gap-4 p-3">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                                            <Icon
                                                aria-hidden="true"
                                                className="size-4 text-muted-foreground"
                                            />
                                        </span>
                                        <span className="truncate text-sm font-medium">
                                            {label}
                                        </span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <span className="text-base font-semibold tabular-nums">
                                            {numberFormat.format(stats[key])}
                                        </span>
                                        <ArrowUpRight
                                            aria-hidden="true"
                                            className="size-4 text-muted-foreground transition-colors group-hover:text-foreground"
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </section>
            </div>

            <section aria-labelledby="analytics-heading" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2
                            id="analytics-heading"
                            className="text-lg font-semibold tracking-tight"
                        >
                            Google Analytics
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Hiệu suất website trong 30 ngày gần nhất.
                        </p>
                    </div>
                    <Button
                        asChild
                        variant="ghost"
                        className="text-muted-foreground"
                    >
                        <Link href="/settings/google-analytics">
                            <Settings2 aria-hidden="true" />
                            Cấu hình Analytics
                        </Link>
                    </Button>
                </div>

                <Deferred
                    data={['analytics', 'analyticsError']}
                    fallback={<AnalyticsSkeleton />}
                >
                    {analytics ? (
                        <>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                {analyticsCards.map(
                                    ({ label, value, icon: Icon }) => (
                                        <Card
                                            key={label}
                                            className="shadow-none"
                                        >
                                            <CardContent className="flex items-start justify-between gap-3 p-5">
                                                <div className="min-w-0">
                                                    <p className="text-sm text-muted-foreground">
                                                        {label}
                                                    </p>
                                                    <p className="mt-2 truncate text-2xl font-semibold tracking-tight tabular-nums">
                                                        {value}
                                                    </p>
                                                </div>
                                                <Icon
                                                    aria-hidden="true"
                                                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                                                />
                                            </CardContent>
                                        </Card>
                                    ),
                                )}
                            </div>

                            <Card className="shadow-none">
                                <CardHeader>
                                    <CardTitle className="text-base">
                                        Lưu lượng truy cập
                                    </CardTitle>
                                    <CardDescription>
                                        Khách truy cập và lượt xem trang theo
                                        ngày.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {analytics.trend.length > 0 ? (
                                        <Suspense
                                            fallback={
                                                <Skeleton className="h-72 w-full" />
                                            }
                                        >
                                            <TrafficChart
                                                trend={analytics.trend}
                                            />
                                        </Suspense>
                                    ) : (
                                        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                                            Chưa có dữ liệu biểu đồ.
                                        </div>
                                    )}
                                    <div className="mt-3 flex flex-wrap gap-5 text-xs text-muted-foreground">
                                        <span className="inline-flex items-center gap-2">
                                            <span className="size-2 rounded-full bg-primary" />
                                            Khách truy cập
                                        </span>
                                        <span className="inline-flex items-center gap-2">
                                            <span className="size-2 rounded-full bg-chart-2" />
                                            Lượt xem trang
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                <BreakdownCard
                                    title="Nguồn truy cập"
                                    description="Các nguồn mang phiên truy cập đến website."
                                    rows={analytics.sources.map((row) => ({
                                        name: row.name,
                                        value: row.sessions,
                                    }))}
                                    valueLabel="Phiên"
                                    formatValue={numberFormat.format}
                                />
                                <BreakdownCard
                                    title="Trang được xem nhiều"
                                    description="Các trang có nhiều lượt xem nhất."
                                    rows={analytics.pages.map((row) => ({
                                        name: row.name,
                                        value: row.views,
                                    }))}
                                    valueLabel="Lượt xem"
                                    formatValue={numberFormat.format}
                                />
                                <BreakdownCard
                                    title="Thiết bị"
                                    description="Phiên truy cập theo loại thiết bị."
                                    rows={analytics.devices.map((row) => ({
                                        name: row.name,
                                        value: row.sessions,
                                    }))}
                                    valueLabel="Phiên"
                                    formatValue={numberFormat.format}
                                />
                            </div>
                        </>
                    ) : (
                        <Card
                            className="shadow-none"
                            role={analyticsError ? 'alert' : undefined}
                        >
                            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                                <div className="min-w-0 space-y-1">
                                    <p className="font-medium">
                                        {analyticsError
                                            ? 'Không tải được dữ liệu Google Analytics.'
                                            : 'Google Analytics chưa được kết nối.'}
                                    </p>
                                    <p className="max-w-2xl text-sm text-muted-foreground">
                                        {analyticsError
                                            ? 'Kiểm tra GA4 Property ID, quyền Viewer của service account và quyền truy cập Google Analytics Data API.'
                                            : 'Thêm GA4 Property ID và service account JSON key để hiển thị lượt truy cập, biểu đồ, nguồn truy cập và thiết bị.'}
                                    </p>
                                </div>
                                <Button asChild variant="outline" size="sm">
                                    <Link href="/settings/google-analytics">
                                        {analyticsError
                                            ? 'Cấu hình Analytics'
                                            : 'Kết nối Google Analytics'}
                                    </Link>
                                </Button>
                            </CardContent>
                        </Card>
                    )}
                </Deferred>
            </section>
        </main>
    );
}
