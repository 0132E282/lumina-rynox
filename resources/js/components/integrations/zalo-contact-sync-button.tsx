import { isAxiosError } from 'axios';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { sync } from '@/actions/App/Http/Controllers/ZaloContactsController';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { ZaloContactSyncResult } from '@/types';

const FALLBACK_ERROR = 'Không đồng bộ được danh bạ Zalo, hãy thử lại sau.';
const THROTTLED_ERROR = 'Bạn đồng bộ quá nhiều lần, hãy thử lại sau ít phút.';

/** * Pulls the friends and groups of ONE Zalo account into `/chat` (names only, no message history) and reports the result in a toast. */
export function ZaloContactSyncButton({
    accountId,
    onSynced,
    disabled = false,
}: {
    accountId: number;
    onSynced?: () => void;
    disabled?: boolean;
}) {
    const [working, setWorking] = useState(false);

    const run = async () => {
        if (working) {
            return;
        }

        setWorking(true);

        try {
            const { data } = await api.post<ZaloContactSyncResult>(
                sync.url(accountId),
            );

            toast.success(
                `Đã đồng bộ ${data.friends} bạn bè và ${data.groups} nhóm${
                    data.truncated ? ' (danh bạ lớn nên chỉ lấy một phần)' : ''
                }.`,
            );
            onSynced?.();
        } catch (failure) {
            toast.error(
                isAxiosError<{ message?: string }>(failure)
                    ? failure.response?.status === 429
                        ? THROTTLED_ERROR
                        : (failure.response?.data?.message ?? FALLBACK_ERROR)
                    : FALLBACK_ERROR,
            );
        } finally {
            setWorking(false);
        }
    };

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || working}
            onClick={run}
        >
            <RefreshCw
                aria-hidden="true"
                className={working ? 'animate-spin' : undefined}
            />
            {working ? 'Đang đồng bộ...' : 'Đồng bộ danh bạ'}
        </Button>
    );
}
