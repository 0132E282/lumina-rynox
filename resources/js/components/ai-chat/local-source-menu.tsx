import { HardDrive } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';

type LocalStatus = {
    enabled: boolean;
    message: string | null;
    roots: { id: string }[];
    can_read: boolean;
};

/** * "Máy local" source of the code viewer: lists the folders the server allows (ids only) or explains how to turn the feature on. */
export function LocalSourceMenu({
    onSelect,
}: {
    onSelect: (rootId: string) => void;
}) {
    const [status, setStatus] = useState<LocalStatus | null>(null);
    const [failed, setFailed] = useState(false);

    const load = async () => {
        setFailed(false);

        try {
            const { data } = await api.get<LocalStatus>(
                '/ai-chat/local/status',
            );

            setStatus(data);
        } catch {
            setFailed(true);
        }
    };

    return (
        <DropdownMenu onOpenChange={(open) => open && void load()}>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Máy local"
                    title="Máy local: đọc tệp trên máy này"
                    className="size-8 text-muted-foreground"
                >
                    <HardDrive aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-64">
                <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                    Máy local
                </DropdownMenuLabel>
                {failed ? (
                    <p className="px-2 py-1.5 text-sm text-destructive">
                        Không tải được trạng thái.
                    </p>
                ) : status === null ? (
                    <p className="px-2 py-1.5 text-sm text-muted-foreground">
                        Đang tải...
                    </p>
                ) : !status.enabled ? (
                    <div className="flex max-w-72 flex-col gap-1 px-2 py-1.5 text-sm">
                        <p className="font-medium">Chưa bật kết nối local</p>
                        <p className="text-xs text-muted-foreground">
                            {status.message}. Để bật, đặt trong .env:
                            AI_CHAT_LOCAL_ENABLED=true và
                            AI_CHAT_LOCAL_ROOTS=ten=/duong/dan/thu/muc (chỉ chạy
                            ở localhost, không dùng trên production).
                        </p>
                    </div>
                ) : !status.can_read ? (
                    <p className="px-2 py-1.5 text-sm text-muted-foreground">
                        Bạn chưa có quyền đọc tệp local.
                    </p>
                ) : status.roots.length === 0 ? (
                    <p className="px-2 py-1.5 text-sm text-muted-foreground">
                        Chưa có thư mục nào trong AI_CHAT_LOCAL_ROOTS.
                    </p>
                ) : (
                    status.roots.map((root) => (
                        <DropdownMenuItem
                            key={root.id}
                            onSelect={() => onSelect(root.id)}
                        >
                            {root.id}
                        </DropdownMenuItem>
                    ))
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
