import { isAxiosError } from 'axios';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    cliLogin,
    cliStatus,
} from '@/actions/App/Http/Controllers/AiAccountController';
import { api } from '@/lib/api';

const POLL_MS = 2000;
const GIVE_UP_MS = 180_000;

type State = 'checking' | 'out' | 'waiting' | 'in' | 'failed';

// * What a refused request means for the person clicking; the server's own text is never shown.
const REASONS: Record<number, string> = {
    403: 'Bạn không có quyền sửa tích hợp.',
    419: 'Phiên đã hết hạn, hãy tải lại trang (Cmd+Shift+R).',
    422: 'Trang đang dùng bản cũ, hãy tải lại trang (Cmd+Shift+R).',
    429: 'Bấm quá nhanh, thử lại sau một phút.',
};

/**
 * "Đăng nhập" of a CLI account: the CLI opens its own browser login on the machine that runs the app; this polls until it reports a
 * signed-in user. No token is typed or kept here.
 */
export function CliLogin({ vendor }: { vendor: 'anthropic' | 'openai' }) {
    const cli = vendor === 'anthropic' ? 'claude' : 'codex';
    const [state, setState] = useState<State>('checking');
    const [reason, setReason] = useState<string | null>(null);
    const timer = useRef<number | null>(null);
    const startedAt = useRef(0);

    const stop = () => {
        if (timer.current !== null) {
            window.clearInterval(timer.current);
            timer.current = null;
        }
    };

    const check = async () => {
        try {
            const { data } = await api.get<{ logged_in: boolean }>(
                cliStatus.url({ query: { vendor } }),
            );

            return data.logged_in;
        } catch {
            return false;
        }
    };

    useEffect(() => {
        let cancelled = false;

        void check().then((loggedIn) => {
            if (!cancelled) {
                setState(loggedIn ? 'in' : 'out');
            }
        });

        return () => {
            cancelled = true;
            stop();
        };
    }, []);

    const login = async () => {
        setState('waiting');
        setReason(null);

        try {
            const { data } = await api.post<{ started: boolean }>(
                cliLogin.url(),
                {
                    vendor,
                },
            );

            if (!data.started) {
                setReason(
                    'Máy chủ không chạy được lệnh đăng nhập (kiểm tra CLI đã cài chưa).',
                );
                setState('failed');

                return;
            }
        } catch (error) {
            setReason(
                (isAxiosError(error) && error.response
                    ? REASONS[error.response.status]
                    : undefined) ?? 'Không gửi được yêu cầu tới máy chủ.',
            );
            setState('failed');

            return;
        }

        startedAt.current = Date.now();
        stop();
        timer.current = window.setInterval(() => {
            void check().then((loggedIn) => {
                if (loggedIn) {
                    stop();
                    setState('in');
                } else if (Date.now() - startedAt.current > GIVE_UP_MS) {
                    stop();
                    setState('out');
                }
            });
        }, POLL_MS);
    };

    return (
        <div className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm">
                    {state === 'in' && (
                        <>
                            <CheckCircle2
                                aria-hidden="true"
                                className="size-4 text-green-600"
                            />
                            CLI {cli} đã đăng nhập
                        </>
                    )}
                    {state === 'checking' && 'Đang kiểm tra đăng nhập…'}
                    {state === 'out' && `CLI ${cli} chưa đăng nhập`}
                    {state === 'waiting' && (
                        <>
                            <Loader2
                                aria-hidden="true"
                                className="size-4 motion-safe:animate-spin"
                            />
                            Đang chờ bạn đăng nhập trong trình duyệt…
                        </>
                    )}
                    {state === 'failed' &&
                        (reason ?? 'Không chạy được lệnh đăng nhập')}
                </span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={state === 'checking' || state === 'waiting'}
                    onClick={() => void login()}
                >
                    {state === 'in' ? 'Đăng nhập lại' : 'Đăng nhập'}
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">
                Trình duyệt sẽ mở trên máy đang chạy ứng dụng này. Chỉ dùng được
                khi ứng dụng chạy trên chính máy của bạn.
            </p>
        </div>
    );
}
