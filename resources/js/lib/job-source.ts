import { formatDateTimePersonal } from '@/lib/personal-date';
import type { JobSource } from '@/types';

const STATUS_LABELS: Record<string, string> = {
    ok: 'Lần đọc gần nhất thành công',
    blocked: 'Bị chặn',
    disallowed: 'robots.txt không cho phép',
    unsupported: 'Chưa hỗ trợ',
    no_criteria: 'Chưa có CV có từ khoá',
    error: 'Lỗi khi đọc',
    skipped: 'Bỏ qua',
};

export function crawlStatusLine(source: JobSource): string {
    if (source.crawl && !source.enabled) {
        return 'Đang tắt';
    }

    if (!source.last_status || !source.last_at) {
        return 'Chưa đọc lần nào';
    }

    return `${STATUS_LABELS[source.last_status] ?? source.last_status} · ${formatDateTimePersonal(source.last_at)}`;
}

// * Job-alert e-mail ingest (php artisan jobs:ingest-alerts); `no_mailbox` means no connected mailbox yet.
export function emailStatusLine(source: JobSource): string {
    if (!source.email_last_status || !source.email_last_at) {
        return 'Email job-alert: chưa nhập lần nào';
    }

    const at = formatDateTimePersonal(source.email_last_at);

    if (source.email_last_status === 'no_mailbox') {
        return `Email job-alert: chưa kết nối hộp thư · ${at}`;
    }

    return `Email job-alert: nhập ${source.email_last_count ?? 0} việc ở lần chạy gần nhất · ${at}`;
}
