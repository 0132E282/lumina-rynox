import { isAxiosError } from 'axios';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
    cliLogin,
    cliStatus,
} from '@/actions/App/Http/Controllers/AiAccountController';
import { api } from '@/lib/api';

const POLL_MS = 2000;
const GIVE_UP_MS = 180_000;

export type CliLoginState = 'checking' | 'out' | 'waiting' | 'in' | 'failed';

// * What a refused request means for the person clicking; the server's own text is never shown.
const REASONS: Record<number, string> = {
    403: 'Bạn không có quyền sửa tích hợp.',
    419: 'Phiên đã hết hạn, hãy tải lại trang (Cmd+Shift+R).',
    422: 'Trang đang dùng bản cũ, hãy tải lại trang (Cmd+Shift+R).',
    429: 'Bấm quá nhanh, thử lại sau một phút.',
};

export type CliVendor = 'anthropic' | 'openai';

/** * Which CLI a vendor logs in with, or null for vendors without a login flow here. */
export const cliVendorOf = (vendor: string): CliVendor | null =>
    vendor === 'anthropic' || vendor === 'openai' ? vendor : null;

/**
 * The CLI login of an account: the CLI opens its own browser login on the machine that runs the app; `login()` polls until it reports a
 * signed-in user and resolves true then (false on any failure or timeout, with `reason` set). No token is typed or kept here.
 */
export function useCliLogin(vendor: CliVendor | null) {
    const [state, setState] = useState<CliLoginState>('checking');
    const [reason, setReason] = useState<string | null>(null);
    const timer = useRef<number | null>(null);
    const alive = useRef(true);

    const stop = () => {
        if (timer.current !== null) {
            window.clearInterval(timer.current);
            timer.current = null;
        }
    };

    const check = async (target: CliVendor) => {
        try {
            const { data } = await api.get<{ logged_in: boolean }>(
                cliStatus.url({ query: { vendor: target } }),
            );

            return data.logged_in;
        } catch {
            return false;
        }
    };

    useEffect(() => {
        alive.current = true;

        if (vendor === null) {
            return;
        }

        setState('checking');
        setReason(null);
        void check(vendor).then((loggedIn) => {
            if (alive.current) {
                setState(loggedIn ? 'in' : 'out');
            }
        });

        return () => {
            alive.current = false;
            stop();
        };
    }, [vendor]);

    const login = async (): Promise<boolean> => {
        if (vendor === null) {
            return false;
        }

        setState('waiting');
        setReason(null);

        try {
            const { data } = await api.post<{ started: boolean }>(
                cliLogin.url(),
                { vendor },
            );

            if (!data.started) {
                setReason(
                    'Máy chủ không chạy được lệnh đăng nhập (kiểm tra CLI đã cài chưa).',
                );
                setState('failed');

                return false;
            }
        } catch (error) {
            setReason(
                (isAxiosError(error) && error.response
                    ? REASONS[error.response.status]
                    : undefined) ?? 'Không gửi được yêu cầu tới máy chủ.',
            );
            setState('failed');

            return false;
        }

        const startedAt = Date.now();

        stop();

        return new Promise<boolean>((resolve) => {
            timer.current = window.setInterval(() => {
                void check(vendor).then((loggedIn) => {
                    if (!alive.current) {
                        stop();
                        resolve(false);
                    } else if (loggedIn) {
                        stop();
                        setState('in');
                        resolve(true);
                    } else if (Date.now() - startedAt > GIVE_UP_MS) {
                        stop();
                        setReason('Hết thời gian chờ, hãy bấm Đăng nhập lại.');
                        setState('out');
                        resolve(false);
                    }
                });
            }, POLL_MS);
        });
    };

    return { state, reason, login };
}

/** * Status of the CLI login (the sign-in itself is the dialog's primary button). */
export function CliLogin({
    vendor,
    state,
    reason,
}: {
    vendor: CliVendor;
    state: CliLoginState;
    reason: string | null;
}) {
    const cli = vendor === 'anthropic' ? 'claude' : 'codex';

    return (
        <div className="flex flex-col gap-2 rounded-md border p-3">
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
                {state === 'failed' && 'Không chạy được lệnh đăng nhập'}
            </span>
            {reason && (
                <p role="alert" className="text-xs text-destructive">
                    {reason}
                </p>
            )}
            <p className="text-xs text-muted-foreground">
                Trình duyệt sẽ mở trên máy đang chạy ứng dụng này. Chỉ dùng được
                khi ứng dụng chạy trên chính máy của bạn.
            </p>
        </div>
    );
}
