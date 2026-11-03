import { Deferred, Link, router } from '@inertiajs/react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PersonalModule, TaskDashboardSummary } from '@/types';

export type PersonalSummaryProps = {
    personalModules: PersonalModule[];
    tasksSummary?: TaskDashboardSummary | null;
};

function ModuleCard({
    module,
    title,
    footer,
    summary,
    children,
}: {
    module: PersonalModule;
    title: string;
    footer?: ReactNode;
    /** * `undefined` while deferred, `null` when the load failed. */
    summary: unknown;
    children: ReactNode;
}) {
    const propName = `${module}Summary`;

    return (
        <Card className="min-w-0 shadow-none">
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
                <Deferred
                    data={propName}
                    fallback={
                        <div aria-busy="true" className="space-y-2">
                            <Skeleton className="h-6 w-1/2" />
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-2/3" />
                        </div>
                    }
                >
                    {summary === null || summary === undefined ? (
                        <Alert variant="destructive">
                            <AlertDescription className="flex flex-wrap items-center gap-3">
                                Không tải được dữ liệu.
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    onClick={() =>
                                        router.reload({ only: [propName] })
                                    }
                                >
                                    Thử lại
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <>
                            {children}
                            {footer && (
                                <div className="mt-auto pt-2">{footer}</div>
                            )}
                        </>
                    )}
                </Deferred>
            </CardContent>
        </Card>
    );
}

function EmptyState({
    message,
    action,
}: {
    message: string;
    action: ReactNode;
}) {
    return (
        <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">{message}</p>
            {action}
        </div>
    );
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <Button asChild variant="outline" size="sm">
            <Link href={href}>{children}</Link>
        </Button>
    );
}

function TaskCard({ summary }: { summary?: TaskDashboardSummary | null }) {
    return (
        <ModuleCard
            module="tasks"
            title="Công việc"
            summary={summary}
            footer={
                summary && summary.pending === 0 ? undefined : (
                    <CardLink href="/tasks">Xem tất cả</CardLink>
                )
            }
        >
            {summary && summary.pending === 0 ? (
                <EmptyState
                    message="Không còn công việc nào chưa xong."
                    action={
                        <div className="flex flex-wrap gap-2">
                            <CardLink href="/tasks">Thêm công việc</CardLink>
                            <CardLink href="/tasks">Xem tất cả</CardLink>
                        </div>
                    }
                />
            ) : (
                summary && (
                    <>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-2xl font-semibold tabular-nums">
                                {summary.pending}
                            </span>
                            <span className="text-sm text-muted-foreground">
                                chưa xong
                            </span>
                            {summary.overdue > 0 && (
                                <Badge variant="destructive">
                                    {summary.overdue} quá hạn
                                </Badge>
                            )}
                        </div>
                        <ul className="space-y-1 text-sm">
                            {summary.upcoming.map((task) => (
                                <li key={task.id} className="truncate">
                                    <Link
                                        href={`/tasks/${task.id}`}
                                        className="hover:underline"
                                    >
                                        {task.title}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </>
                )
            )}
        </ModuleCard>
    );
}

/** * Summary cards for the Personal Manager modules the user may view; each loads in its own deferred request. */
export function PersonalSummary({
    personalModules,
    tasksSummary,
}: PersonalSummaryProps) {
    if (personalModules.length === 0) {
        return null;
    }

    return (
        <section aria-labelledby="personal-heading" className="space-y-4">
            <h2 id="personal-heading" className="sr-only">
                Công việc và cá nhân
            </h2>
            <div className="grid grid-cols-1 gap-4">
                {personalModules.includes('tasks') && (
                    <TaskCard summary={tasksSummary} />
                )}
            </div>
        </section>
    );
}
