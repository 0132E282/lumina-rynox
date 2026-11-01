import { Head, Link, useForm } from '@inertiajs/react';
import { CircleHelp, CircleCheck, CircleAlert } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
    index,
    store,
    test,
    update,
} from '@/actions/App/Http/Controllers/MailboxController';
import InputError from '@/components/input-error';
import { PlatformLogo } from '@/components/posts/platform-logo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type {
    MailAccountsFormProps,
    MailConnectionTest,
    MailPreset,
    MailPresetKey,
    MailboxForm,
} from '@/types';

type PresetStyle = {
    letter: string;
    color: string;
    description: string;
    steps: string[];
};

const PRESET_STYLES: Record<MailPresetKey, PresetStyle> = {
    gmail: {
        letter: 'G',
        color: '#e5484d',
        description: 'Đăng nhập bằng mật khẩu ứng dụng',
        steps: [
            'Bật xác minh 2 bước cho tài khoản Google.',
            'Vào mục Mật khẩu ứng dụng và tạo mật khẩu mới.',
            'Dán mật khẩu 16 ký tự vào ô bên trái.',
        ],
    },
    outlook: {
        letter: 'O',
        color: '#2f6fed',
        description: 'Microsoft 365 và Outlook.com',
        steps: [
            'Bật xác minh 2 bước cho tài khoản Microsoft.',
            'Tạo mật khẩu ứng dụng ở trang bảo mật tài khoản.',
            'Dán mật khẩu vào ô bên trái.',
        ],
    },
    imap: {
        letter: 'I',
        color: '#71717a',
        description: 'Máy chủ mail riêng',
        steps: [
            'Lấy địa chỉ máy chủ IMAP/SMTP và mật khẩu (hoặc mật khẩu ứng dụng) từ nhà cung cấp.',
            'Chỉ nhận cổng có mã hoá: IMAP 993 hoặc 143, SMTP 465 hoặc 587.',
            'Máy chủ nằm trong mạng nội bộ bị chặn.',
        ],
    },
};

const PRESET_LABELS: Record<MailPresetKey, string> = {
    gmail: 'Gmail',
    outlook: 'Outlook',
    imap: 'IMAP khác',
};

type FormErrors = Partial<Record<keyof MailboxForm, string>>;

export default function MailAccountsForm({
    mailbox,
    presets,
    sync_intervals,
}: MailAccountsFormProps) {
    const form = useForm<MailboxForm>({
        provider_preset: mailbox?.provider_preset ?? 'gmail',
        email: mailbox?.email ?? '',
        password: '',
        imap:
            mailbox?.imap ?? presets.find((p) => p.key === 'gmail')?.imap ?? '',
        smtp:
            mailbox?.smtp ?? presets.find((p) => p.key === 'gmail')?.smtp ?? '',
        sync_interval_minutes: mailbox?.sync_interval_minutes ?? 5,
        save_sent_copy: mailbox?.save_sent_copy ?? false,
    });
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<MailConnectionTest | null>(null);
    const [testErrors, setTestErrors] = useState<FormErrors>({});

    const preset = form.data.provider_preset;
    const presetConfig: MailPreset | undefined = presets.find(
        (entry) => entry.key === preset,
    );
    const errors: FormErrors = { ...form.errors, ...testErrors };

    const choosePreset = (key: MailPresetKey) => {
        const next = presets.find((entry) => entry.key === key);

        form.setData((data) => ({
            ...data,
            provider_preset: key,
            // * A preset fills the servers in; "IMAP khác" keeps what is typed so a custom host is not lost.
            imap: next?.imap ?? data.imap,
            smtp: next?.smtp ?? data.smtp,
            save_sent_copy: next?.save_sent_copy ?? data.save_sent_copy,
        }));
        setResult(null);
    };

    const checkConnection = async () => {
        setChecking(true);
        setResult(null);
        setTestErrors({});

        try {
            const response = await api.post<MailConnectionTest>(test.url(), {
                ...form.data,
                mailbox_id: mailbox?.id ?? null,
            });
            setResult(response.data);
        } catch (error: unknown) {
            const fieldErrors = (
                error as {
                    response?: { data?: { errors?: Record<string, string[]> } };
                }
            ).response?.data?.errors;

            if (fieldErrors) {
                setTestErrors(
                    Object.fromEntries(
                        Object.entries(fieldErrors).map(([key, messages]) => [
                            key,
                            messages[0],
                        ]),
                    ),
                );
            } else {
                setResult({
                    ok: false,
                    imap_error: 'Không kiểm tra được, thử lại sau.',
                    smtp_error: null,
                });
            }
        } finally {
            setChecking(false);
        }
    };

    const submit = (event: FormEvent) => {
        event.preventDefault();
        setTestErrors({});

        if (mailbox) {
            form.put(update.url({ mailbox: mailbox.id }));
        } else {
            form.post(store.url());
        }
    };

    const steps = PRESET_STYLES[preset].steps;
    const field = (key: 'email' | 'password' | 'imap' | 'smtp') => ({
        value: form.data[key],
        onChange: (event: { target: { value: string } }) => {
            form.setData(key, event.target.value);
            setResult(null);
        },
        'aria-invalid': !!errors[key],
    });

    return (
        <div className="grid flex-1 gap-6 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Head title={mailbox ? 'Sửa hộp thư' : 'Thêm hộp thư'} />

            <form onSubmit={submit} className="grid content-start gap-6">
                <h1 className="text-xl font-semibold">
                    {mailbox ? 'Sửa hộp thư' : 'Thêm hộp thư'}
                </h1>

                <Card>
                    <CardHeader className="border-b">
                        <CardTitle>Nhà cung cấp</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div
                            role="radiogroup"
                            aria-label="Nhà cung cấp"
                            className="grid gap-3 sm:grid-cols-3"
                        >
                            {presets.map((entry) => {
                                const style = PRESET_STYLES[entry.key];
                                const selected = entry.key === preset;

                                return (
                                    <button
                                        key={entry.key}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        onClick={() => choosePreset(entry.key)}
                                        className={cn(
                                            'flex items-center gap-3 rounded-md border p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                                            selected &&
                                                'border-primary bg-accent',
                                        )}
                                    >
                                        <PlatformLogo
                                            letter={style.letter}
                                            color={style.color}
                                        />
                                        <span className="flex flex-col">
                                            <span className="font-medium">
                                                {PRESET_LABELS[entry.key]}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {style.description}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        {presetConfig?.warning && (
                            <Alert className="mt-3">
                                <CircleAlert />
                                <AlertDescription>
                                    {presetConfig.warning}
                                </AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="border-b">
                        <CardTitle>Thông tin hộp thư</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="mail-email">Địa chỉ email</Label>
                            <Input
                                id="mail-email"
                                type="email"
                                autoComplete="off"
                                maxLength={255}
                                {...field('email')}
                            />
                            <InputError message={errors.email} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="mail-password">
                                Mật khẩu ứng dụng
                            </Label>
                            <Input
                                id="mail-password"
                                type="password"
                                autoComplete="new-password"
                                maxLength={1000}
                                placeholder={
                                    mailbox?.password_mask ?? undefined
                                }
                                {...field('password')}
                            />
                            <p className="text-xs text-muted-foreground">
                                {mailbox?.has_password
                                    ? 'Để trống để giữ mật khẩu đã lưu. '
                                    : ''}
                                Tạo trong cài đặt bảo mật của nhà cung cấp. Mật
                                khẩu được lưu mã hoá.
                            </p>
                            <InputError message={errors.password} />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="grid gap-2">
                                <Label htmlFor="mail-imap">Máy chủ IMAP</Label>
                                <Input
                                    id="mail-imap"
                                    placeholder="imap.example.com:993"
                                    autoComplete="off"
                                    {...field('imap')}
                                />
                                <InputError message={errors.imap} />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="mail-smtp">Máy chủ SMTP</Label>
                                <Input
                                    id="mail-smtp"
                                    placeholder="smtp.example.com:587"
                                    autoComplete="off"
                                    {...field('smtp')}
                                />
                                <InputError message={errors.smtp} />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="mail-interval">
                                Tần suất đồng bộ
                            </Label>
                            <Select
                                value={String(form.data.sync_interval_minutes)}
                                onValueChange={(value) =>
                                    form.setData(
                                        'sync_interval_minutes',
                                        Number(value),
                                    )
                                }
                            >
                                <SelectTrigger
                                    id="mail-interval"
                                    className="w-full"
                                    aria-invalid={
                                        !!errors.sync_interval_minutes
                                    }
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {sync_intervals.map((minutes) => (
                                        <SelectItem
                                            key={minutes}
                                            value={String(minutes)}
                                        >
                                            Mỗi {minutes} phút
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <InputError
                                message={errors.sync_interval_minutes}
                            />
                        </div>
                        <div className="flex items-start gap-3">
                            <Checkbox
                                id="mail-sent-copy"
                                className="mt-0.5"
                                checked={form.data.save_sent_copy}
                                onCheckedChange={(value) =>
                                    form.setData(
                                        'save_sent_copy',
                                        value === true,
                                    )
                                }
                            />
                            <Label
                                htmlFor="mail-sent-copy"
                                className="flex flex-col items-start gap-0.5 font-normal"
                            >
                                <span>
                                    Lưu bản sao thư đã gửi vào thư mục Đã gửi
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    Gmail tự lưu thư gửi qua SMTP nên không cần
                                    bật.
                                </span>
                            </Label>
                        </div>

                        <div
                            aria-live="polite"
                            className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                            {checking ? (
                                <>
                                    <CircleHelp
                                        aria-hidden="true"
                                        className="mt-0.5 size-4 text-muted-foreground"
                                    />
                                    <span className="text-muted-foreground">
                                        Đang kiểm tra kết nối…
                                    </span>
                                </>
                            ) : result === null ? (
                                <>
                                    <CircleHelp
                                        aria-hidden="true"
                                        className="mt-0.5 size-4 text-muted-foreground"
                                    />
                                    <span className="text-muted-foreground">
                                        Chưa kiểm tra kết nối
                                    </span>
                                </>
                            ) : result.ok ? (
                                <>
                                    <CircleCheck
                                        aria-hidden="true"
                                        className="mt-0.5 size-4 text-chart-2"
                                    />
                                    <span>
                                        Đăng nhập IMAP và SMTP thành công.
                                    </span>
                                </>
                            ) : (
                                <>
                                    <CircleAlert
                                        aria-hidden="true"
                                        className="mt-0.5 size-4 text-destructive"
                                    />
                                    <span className="flex flex-col">
                                        {result.imap_error && (
                                            <span>
                                                IMAP: {result.imap_error}
                                            </span>
                                        )}
                                        {result.smtp_error && (
                                            <span>
                                                SMTP: {result.smtp_error}
                                            </span>
                                        )}
                                    </span>
                                </>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <div className="flex flex-wrap gap-2">
                    <Button
                        type="submit"
                        disabled={form.processing || checking}
                    >
                        {form.processing ? 'Đang lưu…' : 'Lưu hộp thư'}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={form.processing || checking}
                        onClick={checkConnection}
                    >
                        Kiểm tra kết nối
                    </Button>
                    <Link
                        href={index.url()}
                        className={buttonVariants({ variant: 'outline' })}
                    >
                        Huỷ
                    </Link>
                </div>
            </form>

            <aside className="grid content-start gap-4">
                <Card>
                    <CardHeader className="border-b">
                        <CardTitle>Tạo mật khẩu ứng dụng</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ol className="list-decimal space-y-2 pl-5 text-sm">
                            {steps.map((step) => (
                                <li key={step}>{step}</li>
                            ))}
                        </ol>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="border-b">
                        <CardTitle>Quyền truy cập</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ul className="list-disc space-y-2 pl-5 text-sm">
                            <li>Đọc và gửi thư qua IMAP/SMTP.</li>
                            <li>Không xoá thư trên máy chủ.</li>
                            <li>Mật khẩu lưu mã hoá, có thể thu hồi.</li>
                        </ul>
                    </CardContent>
                </Card>
            </aside>
        </div>
    );
}
