import {
    AlertCircle,
    AlertTriangle,
    Check,
    Clock,
    FileText,
    HelpCircle,
    Loader2,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PostStatus, PostTargetStatus } from '@/types';

type IconComponent = ComponentType<{ className?: string }>;

// * Backend error texts (PostController, *PersonalPublisher::FAILURES) that are not shown as a note.
const HIDDEN_ERROR_PATTERNS = [
    /^Đã dừng thủ công, bài chưa được đăng\.$/,
    /^Không tải được ảnh của bài để đăng lên .+ \(link hỏng, quá 10MB hoặc không phải ảnh\), bài chưa được đăng\.$/,
];

export function shouldShowDeliveryError(
    error: string | null | undefined,
): error is string {
    return (
        !!error && !HIDDEN_ERROR_PATTERNS.some((pattern) => pattern.test(error))
    );
}

const POST_STATUS: Record<
    PostStatus,
    {
        label: string;
        icon: IconComponent;
        variant: 'default' | 'secondary' | 'destructive' | 'outline';
    }
> = {
    draft: { label: 'Nháp', icon: FileText, variant: 'outline' },
    scheduled: { label: 'Đã lên lịch', icon: Clock, variant: 'outline' },
    publishing: { label: 'Đang đăng', icon: Loader2, variant: 'secondary' },
    published: { label: 'Đã đăng', icon: Check, variant: 'default' },
    partial: {
        label: 'Đăng một phần',
        icon: AlertTriangle,
        variant: 'secondary',
    },
    failed: { label: 'Lỗi đăng', icon: AlertCircle, variant: 'destructive' },
    missed: {
        label: 'Đã lỡ lịch',
        icon: AlertTriangle,
        variant: 'destructive',
    },
};

/** * Status as text plus an icon, never colour alone. */
export function PostStatusBadge({ status }: { status: PostStatus }) {
    const { label, icon: Icon, variant } = POST_STATUS[status];

    return (
        <Badge variant={variant}>
            <Icon
                aria-hidden="true"
                className={cn(status === 'publishing' && 'animate-spin')}
            />
            {label}
        </Badge>
    );
}

export const TARGET_STATUS: Record<
    PostTargetStatus,
    { icon: IconComponent; className: string }
> = {
    pending: { icon: Clock, className: 'text-muted-foreground' },
    publishing: { icon: Loader2, className: 'text-muted-foreground' },
    published: { icon: Check, className: 'text-emerald-600' },
    failed: { icon: AlertCircle, className: 'text-destructive' },
    unknown: { icon: HelpCircle, className: 'text-amber-600' },
};
