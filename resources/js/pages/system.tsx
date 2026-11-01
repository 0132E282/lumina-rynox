import { Link, Head, usePage } from '@inertiajs/react';
import { useState } from 'react';
import { ArrowUpRight, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ICON_MAP } from '@/lib/icon-map';
import { xsrfToken } from '@/lib/xsrf';

type SystemSettingItem = {
    key: string;
    title: string;
    description: string;
    url: string;
    icon: string;
    confirmPassword?: boolean;
};

async function isPasswordConfirmed(): Promise<boolean> {
    const response = await fetch('/app-password/status', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
    });
    const data = await response.json();

    return Boolean(data.confirmed);
}

export default function System() {
    const { systemSettings } = usePage<{
        systemSettings: SystemSettingItem[];
    }>().props;
    const [pendingHref, setPendingHref] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleGatedClick = async (e: React.MouseEvent, href: string) => {
        e.preventDefault();

        if (await isPasswordConfirmed()) {
            location.assign(href);

            return;
        }

        setPendingHref(href);
        setPassword('');
        setError('');
    };

    const confirmPassword = async () => {
        if (!pendingHref) {
            return;
        }

        setSubmitting(true);
        setError('');

        const response = await fetch('/app-password/confirm', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-XSRF-TOKEN': xsrfToken(),
            },
            body: JSON.stringify({ password }),
        });

        setSubmitting(false);

        if (response.ok) {
            location.assign(pendingHref);

            return;
        }

        setError('Mật khẩu không đúng. Vui lòng thử lại.');
    };

    return (
        <div className="flex w-full flex-1 flex-col gap-6 p-4 md:p-6">
            <Head title="Hệ thống" />

            <div className="border-b pb-6">
                <h1 className="text-2xl font-semibold tracking-tight">
                    Hệ thống
                </h1>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {systemSettings.map((item) => {
                    const { key, title, description, url: href, icon } = item;
                    const Icon = ICON_MAP[icon];
                    const gated = item.confirmPassword;

                    const card = (
                        <Card className="h-full gap-2 rounded-lg border bg-card py-4 shadow-none transition-colors hover:border-ring hover:bg-muted/30">
                            <CardHeader className="flex flex-row items-center gap-3 space-y-0 px-4">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                                    {Icon && (
                                        <Icon
                                            aria-hidden="true"
                                            className="size-4 text-muted-foreground"
                                        />
                                    )}
                                </span>
                                <CardTitle className="flex-1 text-sm font-semibold">
                                    {title}
                                </CardTitle>
                                {gated ? (
                                    <LockKeyhole
                                        aria-label="Yêu cầu xác nhận mật khẩu"
                                        className="size-4 text-muted-foreground"
                                    />
                                ) : (
                                    <ArrowUpRight
                                        aria-hidden="true"
                                        className="size-4 text-muted-foreground"
                                    />
                                )}
                            </CardHeader>
                            <CardContent className="px-4">
                                <CardDescription className="leading-5">
                                    {description}
                                </CardDescription>
                            </CardContent>
                        </Card>
                    );

                    if (gated) {
                        return (
                            <a
                                key={key}
                                href={href}
                                className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
                                onClick={(e) => handleGatedClick(e, href)}
                            >
                                {card}
                            </a>
                        );
                    }

                    return (
                        <Link
                            key={key}
                            href={href}
                            className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
                        >
                            {card}
                        </Link>
                    );
                })}
            </div>

            <Dialog
                open={pendingHref !== null}
                onOpenChange={(open) => !open && setPendingHref(null)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Xác nhận mật khẩu</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-2">
                        <Label htmlFor="confirm-password">
                            Đây là khu vực nhạy cảm. Vui lòng nhập lại mật khẩu
                            để tiếp tục.
                        </Label>
                        <Input
                            id="confirm-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) =>
                                e.key === 'Enter' && confirmPassword()
                            }
                            autoFocus
                        />
                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setPendingHref(null)}
                        >
                            Hủy
                        </Button>
                        <Button
                            onClick={confirmPassword}
                            disabled={submitting || !password}
                        >
                            {submitting ? 'Đang xác nhận...' : 'Xác nhận'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
