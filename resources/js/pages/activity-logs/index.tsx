import { Head, router } from '@inertiajs/react';
import { RotateCw } from 'lucide-react';
import { useState } from 'react';
import { paginationLabel } from '@/components/file-manager/format';
import Heading from '@/components/heading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn, formatDateTime } from '@/lib/utils';
import type { Paginated } from '@/types/file-manager';

type LogEntry = {
    id: number;
    description: string;
    event: string | null;
    log_name: string;
    subject_type: string | null;
    subject_id: number | null;
    causer_name: string;
    properties: {
        old?: Record<string, unknown>;
        attributes?: Record<string, unknown>;
    } | null;
    created_at: string;
};

type LogGroup = 'login' | 'admin_crud';

const EVENT_META: Record<string, { label: string; className: string }> = {
    created: {
        label: 'Tạo mới',
        className:
            'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400',
    },
    updated: {
        label: 'Cập nhật',
        className:
            'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
    },
    deleted: {
        label: 'Xóa',
        className:
            'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
    },
    login: {
        label: 'Đăng nhập',
        className:
            'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    },
    logout: { label: 'Đăng xuất', className: 'bg-muted text-muted-foreground' },
    import: {
        label: 'Import',
        className:
            'bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
    },
    export: {
        label: 'Export',
        className:
            'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400',
    },
};

const GROUP_TABS: { key: LogGroup; label: string; events: string[] }[] = [
    {
        key: 'login',
        label: 'Đăng nhập / Đăng xuất',
        events: ['login', 'logout'],
    },
    {
        key: 'admin_crud',
        label: 'Thêm / Sửa / Xóa / Import / Export',
        events: ['created', 'updated', 'deleted', 'import', 'export'],
    },
];

function eventBadge(event: string | null) {
    const meta = event ? EVENT_META[event] : undefined;

    return (
        <Badge className={cn('rounded-full', meta?.className)}>
            {meta?.label ?? event ?? '—'}
        </Badge>
    );
}

interface ActivityLogsProps {
    logs: Paginated<LogEntry>;
    search: string;
    group: LogGroup;
    event: string;
    logName: string;
    from: string;
    to: string;
    logNames: string[];
    groupCounts: Record<LogGroup, number>;
    stats: {
        total: number;
        today: number;
        events: Record<string, number>;
    };
}

export default function ActivityLogsIndex({
    logs,
    search,
    group,
    event,
    logName,
    from,
    to,
    logNames,
    groupCounts,
    stats,
}: ActivityLogsProps) {
    const [filters, setFilters] = useState({
        search,
        event,
        log_name: logName,
        from,
        to,
    });
    const [selected, setSelected] = useState<LogEntry | null>(null);

    const activeGroup =
        GROUP_TABS.find((g) => g.key === group) ?? GROUP_TABS[1];

    const applyFilters = (
        overrides: Partial<typeof filters & { group: string }> = {},
    ) => {
        router.get(
            '/activity-logs',
            { group, ...filters, ...overrides },
            { preserveState: true, preserveScroll: true },
        );
    };

    const switchGroup = (nextGroup: string) => {
        const cleared = {
            search: '',
            event: '',
            log_name: '',
            from: '',
            to: '',
        };
        setFilters(cleared);
        router.get(
            '/activity-logs',
            { group: nextGroup },
            { preserveState: true, preserveScroll: true },
        );
    };

    const resetFilters = () => {
        const cleared = {
            search: '',
            event: '',
            log_name: '',
            from: '',
            to: '',
        };
        setFilters(cleared);
        router.get(
            '/activity-logs',
            { group },
            { preserveState: true, preserveScroll: true },
        );
    };

    return (
        <div className="flex flex-1 flex-col gap-4 p-4">
            <Head title="Lịch sử hoạt động" />

            <div className="flex items-center justify-between">
                <Heading
                    title="Lịch sử hoạt động"
                    description="Nhật ký hoạt động của quản trị viên trong hệ thống."
                />
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.reload({ only: ['logs', 'stats'] })}
                >
                    <RotateCw className="size-4" /> Làm mới
                </Button>
            </div>

            <Tabs value={group} onValueChange={switchGroup}>
                <TabsList>
                    {GROUP_TABS.map((tab) => (
                        <TabsTrigger key={tab.key} value={tab.key}>
                            {tab.label}{' '}
                            <span className="ml-1 text-muted-foreground">
                                ({groupCounts[tab.key] ?? 0})
                            </span>
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Card className="p-4">
                    <div className="text-xs text-muted-foreground">
                        Tổng logs
                    </div>
                    <div className="text-2xl font-semibold">{stats.total}</div>
                </Card>
                <Card className="p-4">
                    <div className="text-xs text-muted-foreground">Hôm nay</div>
                    <div className="text-2xl font-semibold">{stats.today}</div>
                </Card>
                <Card className="col-span-2 p-4">
                    <div className="mb-2 text-xs text-muted-foreground">
                        Theo loại hành động
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(stats.events).map(([key, count]) => (
                            <span
                                key={key}
                                className="inline-flex items-center gap-1"
                            >
                                {eventBadge(key)}
                                <span className="text-xs text-muted-foreground">
                                    ({count})
                                </span>
                            </span>
                        ))}
                    </div>
                </Card>
            </div>

            <Card className="flex flex-row flex-wrap items-end gap-3 p-4">
                <div className="min-w-50 flex-1">
                    <Label className="mb-1 text-xs text-muted-foreground">
                        Tìm kiếm
                    </Label>
                    <Input
                        value={filters.search}
                        onChange={(e) =>
                            setFilters((f) => ({
                                ...f,
                                search: e.target.value,
                            }))
                        }
                        placeholder="Tìm theo nội dung..."
                    />
                </div>

                <div className="w-45">
                    <Label className="mb-1 text-xs text-muted-foreground">
                        Hành động
                    </Label>
                    <Select
                        value={filters.event || 'all'}
                        onValueChange={(v) =>
                            setFilters((f) => ({
                                ...f,
                                event: v === 'all' ? '' : v,
                            }))
                        }
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Tất cả" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Tất cả</SelectItem>
                            {activeGroup.events.map((key) => (
                                <SelectItem key={key} value={key}>
                                    {EVENT_META[key]?.label ?? key}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="w-40">
                    <Label className="mb-1 text-xs text-muted-foreground">
                        Log name
                    </Label>
                    <Select
                        value={filters.log_name || 'all'}
                        onValueChange={(v) =>
                            setFilters((f) => ({
                                ...f,
                                log_name: v === 'all' ? '' : v,
                            }))
                        }
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Tất cả" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Tất cả</SelectItem>
                            {logNames.map((name) => (
                                <SelectItem key={name} value={name}>
                                    {name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-end gap-2">
                    <div className="w-35">
                        <Label className="mb-1 text-xs text-muted-foreground">
                            Từ ngày
                        </Label>
                        <Input
                            type="date"
                            value={filters.from}
                            onChange={(e) =>
                                setFilters((f) => ({
                                    ...f,
                                    from: e.target.value,
                                }))
                            }
                        />
                    </div>
                    <div className="w-35">
                        <Label className="mb-1 text-xs text-muted-foreground">
                            Đến ngày
                        </Label>
                        <Input
                            type="date"
                            value={filters.to}
                            onChange={(e) =>
                                setFilters((f) => ({
                                    ...f,
                                    to: e.target.value,
                                }))
                            }
                        />
                    </div>
                </div>

                <Button size="sm" onClick={() => applyFilters()}>
                    Lọc
                </Button>
                <Button size="sm" variant="outline" onClick={resetFilters}>
                    Reset
                </Button>
            </Card>

            <Card className="overflow-hidden p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>ID</TableHead>
                            <TableHead>Hoạt động</TableHead>
                            <TableHead>Đối tượng</TableHead>
                            <TableHead>Người thực hiện</TableHead>
                            <TableHead>Log name</TableHead>
                            <TableHead>Thời gian</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {logs.data.length === 0 && (
                            <TableRow>
                                <TableCell
                                    colSpan={6}
                                    className="text-center text-muted-foreground"
                                >
                                    Chưa có hoạt động nào.
                                </TableCell>
                            </TableRow>
                        )}
                        {logs.data.map((log) => (
                            <TableRow
                                key={log.id}
                                className="cursor-pointer"
                                onClick={() => setSelected(log)}
                            >
                                <TableCell className="text-muted-foreground">
                                    {log.id}
                                </TableCell>
                                <TableCell>{eventBadge(log.event)}</TableCell>
                                <TableCell>
                                    {log.subject_type ? (
                                        <>
                                            <span className="font-medium">
                                                {log.subject_type}
                                            </span>
                                            {log.subject_id && (
                                                <span className="text-muted-foreground">
                                                    {' '}
                                                    #{log.subject_id}
                                                </span>
                                            )}
                                        </>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            {log.description}
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell>{log.causer_name}</TableCell>
                                <TableCell className="text-muted-foreground">
                                    {log.log_name}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-muted-foreground">
                                    {formatDateTime(log.created_at)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <div className="flex items-center justify-between border-t px-4 py-3">
                    <div className="text-sm text-muted-foreground">
                        Trang {logs.current_page} / {logs.last_page}
                    </div>
                    <div className="flex items-center gap-1">
                        {logs.links.map((link, index) => (
                            <Button
                                key={index}
                                type="button"
                                variant={link.active ? 'default' : 'outline'}
                                size="sm"
                                disabled={!link.url}
                                onClick={() =>
                                    link.url &&
                                    router.get(
                                        link.url,
                                        {},
                                        {
                                            preserveState: true,
                                            preserveScroll: true,
                                        },
                                    )
                                }
                            >
                                <span>{paginationLabel(link.label)}</span>
                            </Button>
                        ))}
                    </div>
                </div>
            </Card>

            <Dialog
                open={selected !== null}
                onOpenChange={(open) => !open && setSelected(null)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            Chi tiết hoạt động #{selected?.id}
                        </DialogTitle>
                    </DialogHeader>

                    {selected && (
                        <div className="space-y-3 text-sm">
                            <div className="flex items-center gap-2">
                                {eventBadge(selected.event)}
                                <span className="text-muted-foreground">
                                    {formatDateTime(selected.created_at)}
                                </span>
                            </div>
                            <p>{selected.description}</p>
                            <p className="text-muted-foreground">
                                Người thực hiện:{' '}
                                <span className="text-foreground">
                                    {selected.causer_name}
                                </span>
                            </p>
                            {selected.properties &&
                                Object.keys(selected.properties).length > 0 && (
                                    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                                        {JSON.stringify(
                                            selected.properties,
                                            null,
                                            2,
                                        )}
                                    </pre>
                                )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
