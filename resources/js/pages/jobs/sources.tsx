import { Head, router } from '@inertiajs/react';
import { Search } from 'lucide-react';
import { useState } from 'react';
import {
    crawl,
    toggleSource,
} from '@/actions/App/Http/Controllers/JobPostingController';
import { PlatformLogo } from '@/components/social/platform-logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { crawlStatusLine, emailStatusLine } from '@/lib/job-source';
import type { JobSource } from '@/types';

type SourcesProps = { sources: JobSource[]; can: { update: boolean } };

export default function JobSources({ sources, can }: SourcesProps) {
    const [crawling, setCrawling] = useState<string | null>(null);

    const crawlNow = (source: JobSource) => {
        setCrawling(source.key);
        router.post(
            crawl.url(),
            { source: source.key },
            { preserveScroll: true, onFinish: () => setCrawling(null) },
        );
    };

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
            <Head title="Nơi tìm việc" />
            <p className="text-sm text-muted-foreground">
                Các nơi hệ thống đọc tin tuyển dụng. Chỉ cần bật hoặc tắt: từ
                khoá lấy từ "Từ khoá tìm kiếm" của CV mới nhất, AI chấm độ phù
                hợp với CV và việc dưới 70% bị bỏ qua. Mỗi CV cũng có nút "Tìm
                việc" riêng ở trang CV.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
                {sources.map((source) => (
                    <Card key={source.key}>
                        <CardContent className="grid gap-3">
                            <div className="flex items-center gap-3">
                                <PlatformLogo
                                    provider={source.key}
                                    letter={source.letter}
                                    color={source.color}
                                    className="size-8"
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium">
                                        {source.name}
                                    </div>
                                    <div className="flex gap-1.5 pt-0.5">
                                        {source.crawl && (
                                            <Badge variant="outline">
                                                Quét trang
                                            </Badge>
                                        )}
                                        {source.email && (
                                            <Badge variant="outline">
                                                Email job-alert
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                {source.crawl ? (
                                    <Switch
                                        checked={source.enabled}
                                        disabled={!can.update}
                                        aria-label={`Bật hoặc tắt ${source.name}`}
                                        onCheckedChange={(enabled) =>
                                            router.patch(
                                                toggleSource.url(source.key),
                                                { enabled },
                                                { preserveScroll: true },
                                            )
                                        }
                                    />
                                ) : (
                                    <Badge
                                        variant={
                                            source.active
                                                ? 'default'
                                                : 'secondary'
                                        }
                                    >
                                        {source.active
                                            ? 'Đang bật'
                                            : 'Chưa bật'}
                                    </Badge>
                                )}
                            </div>
                            <dl className="grid gap-1 text-sm">
                                {source.crawl && (
                                    <div>
                                        <dt className="text-xs text-muted-foreground">
                                            Lần đọc gần nhất
                                        </dt>
                                        <dd>{crawlStatusLine(source)}</dd>
                                    </div>
                                )}
                                {source.email && (
                                    <div className="text-xs text-muted-foreground">
                                        {emailStatusLine(source)}
                                    </div>
                                )}
                            </dl>
                            <div className="flex flex-wrap gap-2">
                                {can.update && source.crawl && (
                                    <Button
                                        size="sm"
                                        disabled={
                                            crawling !== null || !source.active
                                        }
                                        onClick={() => crawlNow(source)}
                                    >
                                        <Search className="size-4" />
                                        {crawling === source.key
                                            ? 'Đang tìm...'
                                            : 'Tìm ngay'}
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
