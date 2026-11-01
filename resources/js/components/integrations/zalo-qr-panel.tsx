import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    cancel,
    start,
    status,
} from '@/actions/App/Http/Controllers/ZaloLoginController';
import { api } from '@/lib/api';
import type { ZaloQrState, ZaloQrStatus } from '@/types';

const POLL_INTERVAL_MS = 2000;

type Phase = 'starting' | ZaloQrState;

const FINISHED: Phase[] = ['expired', 'declined', 'error'];

const MESSAGES: Record<Exclude<Phase, 'waiting' | 'logged_in'>, string> = {
    starting: 'Đang tạo mã QR...',
    scanned: 'Đã quét, xác nhận đăng nhập trên điện thoại.',
    expired: 'Mã đã hết hạn.',
    declined: 'Bạn đã từ chối đăng nhập.',
    error: 'Không đăng nhập được Zalo.',
};

/**
 * QR sign-in of ONE new Zalo account, shown inside the "Thêm tài khoản" dialog. Mounting starts a QR session with the chosen scopes;
 * unmounting (closing the dialog) releases a session that has not finished. Other accounts keep running meanwhile.
 */
export function ZaloQrPanel({
    permissions,
    groupMode,
    onLoggedIn,
}: {
    permissions: string[];
    groupMode: string;
    onLoggedIn: () => void;
}) {
    const [phase, setPhase] = useState<Phase>('starting');
    const [image, setImage] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    // * Bumped to ask for a new QR code ("Tạo mã mới").
    const [attempt, setAttempt] = useState(0);
    const loginId = useRef<string | null>(null);
    const onLoggedInRef = useRef(onLoggedIn);
    // * Read once per QR session: changing a scope while the code is shown applies to the next code only.
    const chosen = useRef({ permissions, group_mode: groupMode });

    useEffect(() => {
        onLoggedInRef.current = onLoggedIn;
    }, [onLoggedIn]);

    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const release = (id: string) =>
            void api
                .delete(cancel.url({ query: { login_id: id } }))
                .catch(() => undefined);

        const fail = (error: unknown) => {
            const serverMessage =
                isAxiosError<{ message?: string }>(error) &&
                error.response?.data?.message;

            setPhase('error');
            setImage(null);
            setMessage(serverMessage || MESSAGES.error);
        };

        // * Sequential timeouts, not an interval: the next poll starts only after the previous answer.
        const poll = async (id: string) => {
            try {
                const { data } = await api.get<ZaloQrStatus>(
                    status.url({ query: { login_id: id } }),
                );

                if (stopped) {
                    return;
                }

                setPhase(data.state);
                setImage(data.state === 'waiting' ? data.image : null);
                setMessage(null);

                if (data.state === 'logged_in') {
                    loginId.current = null;
                    onLoggedInRef.current();

                    return;
                }

                if (!FINISHED.includes(data.state)) {
                    timer = setTimeout(() => void poll(id), POLL_INTERVAL_MS);
                }
            } catch (error) {
                if (!stopped) {
                    fail(error);
                }
            }
        };

        const begin = async () => {
            setPhase('starting');
            setImage(null);
            setMessage(null);

            try {
                const { data } = await api.post<{ login_id: string }>(
                    start.url(),
                    { risk_acknowledged: true, ...chosen.current },
                );

                if (stopped) {
                    // * Closed while the request was in flight: drop the session that just started.
                    release(data.login_id);

                    return;
                }

                loginId.current = data.login_id;
                await poll(data.login_id);
            } catch (error) {
                if (!stopped) {
                    fail(error);
                }
            }
        };

        void begin();

        return () => {
            stopped = true;
            clearTimeout(timer);

            // * Leaving before the sign-in ends (or asking for a new code): release the pending QR session on the sidecar.
            if (loginId.current) {
                release(loginId.current);
                loginId.current = null;
            }
        };
    }, [attempt]);

    const text =
        phase === 'waiting' || phase === 'logged_in'
            ? null
            : (message ?? MESSAGES[phase]);

    return (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3">
            {phase === 'waiting' && image && (
                <img
                    src={image}
                    alt="Mã QR đăng nhập Zalo"
                    className="size-52 rounded-md border bg-white p-2"
                />
            )}
            <p role="status" aria-live="polite" className="text-center text-sm">
                {phase === 'waiting' ? 'Đang chờ quét mã.' : text}
            </p>
            {FINISHED.includes(phase) && (
                <Button
                    type="button"
                    onClick={() => setAttempt((current) => current + 1)}
                >
                    {phase === 'error' ? 'Thử lại' : 'Tạo mã mới'}
                </Button>
            )}
        </div>
    );
}
