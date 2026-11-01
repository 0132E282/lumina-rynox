import { isAxiosError } from 'axios';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
    index,
    sync,
} from '@/actions/App/Http/Controllers/SocialGroupController';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { SocialGroupSummary } from '@/types';

const LOAD_ERROR = 'Không tải được danh sách nhóm, hãy thử lại sau.';
const SYNC_ERROR = 'Không đồng bộ được nhóm, hãy thử lại sau.';
const THROTTLED_ERROR = 'Bạn đồng bộ quá nhiều lần, hãy thử lại sau ít phút.';

/** * Groups the personal Facebook / LinkedIn account joined: the saved list plus a manual sync (opens the real Chrome on this machine). */
export function SocialGroupsCard({ provider }: { provider: string }) {
    const [groups, setGroups] = useState<SocialGroupSummary[] | null>(null);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        api.get<{ groups: SocialGroupSummary[] }>(index.url(provider))
            .then(({ data }) => active && setGroups(data.groups))
            .catch(() => active && setError(LOAD_ERROR));

        return () => {
            active = false;
        };
    }, [provider]);

    const run = async () => {
        if (working) {
            return;
        }

        setWorking(true);
        setError(null);

        try {
            const { data } = await api.post<{ groups: SocialGroupSummary[] }>(
                sync.url(provider),
            );

            setGroups(data.groups);
        } catch (failure) {
            setError(
                isAxiosError<{ message?: string }>(failure)
                    ? failure.response?.status === 429
                        ? THROTTLED_ERROR
                        : (failure.response?.data?.message ?? SYNC_ERROR)
                    : SYNC_ERROR,
            );
        } finally {
            setWorking(false);
        }
    };

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 border-b">
                <CardTitle>Nhóm đã tham gia</CardTitle>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={run}
                >
                    <RefreshCw
                        aria-hidden="true"
                        className={working ? 'animate-spin' : undefined}
                    />
                    {working ? 'Đang đồng bộ...' : 'Đồng bộ nhóm'}
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
                {error && <Alert variant="destructive">{error}</Alert>}
                {groups !== null && groups.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                        Chưa có nhóm nào, bấm Đồng bộ nhóm để đọc từ tài khoản.
                    </p>
                )}
                {groups !== null && groups.length > 0 && (
                    <ul className="flex flex-col gap-2">
                        {groups.map((group) => (
                            <li key={group.id} className="flex flex-col">
                                <a
                                    href={group.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium hover:underline"
                                >
                                    {group.name}
                                </a>
                                <span className="text-xs text-muted-foreground">
                                    Đồng bộ: {formatDateTime(group.synced_at)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
