import { Head, Link, router, useForm } from '@inertiajs/react';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useConfirm } from '@/components/confirm-dialog';
import InputError from '@/components/input-error';
import { SocialGroupsCard } from '@/components/integrations/social-groups-card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import {
    destroy,
    index,
    test,
    update,
} from '@/actions/App/Http/Controllers/IntegrationController';
import { start as startLinkedIn } from '@/actions/App/Http/Controllers/LinkedInOAuthController';
import { formatDateTime } from '@/lib/utils';
import type { IntegrationPage, IntegrationStatus } from '@/types';

const STATUS_STYLE: Record<IntegrationStatus, string> = {
    connected: 'bg-secondary text-foreground',
    error: 'bg-destructive text-white',
    disconnected: 'bg-muted text-muted-foreground',
};

// * Provider without runtime code: a saved config is not a live connection, so it must not look green.
const SAVED_CONFIG_STYLE = 'bg-muted text-foreground';

// * Personal accounts whose joined groups can be read from the real Chrome (see SocialGroupSync::PROVIDERS).
const GROUP_PROVIDERS = ['facebook_personal', 'linkedin_personal'];

type FormData = {
    fields: Record<string, string>;
    secrets: Record<string, string>;
    permissions: string[];
    risk_acknowledged: boolean;
};

// * With OAuth sign-in the pasted-token form is only a fallback, so it is collapsed; other providers show it as is.
function ManualSection({
    collapsible,
    children,
}: {
    collapsible: boolean;
    children: ReactNode;
}) {
    if (!collapsible) {
        return <>{children}</>;
    }

    return (
        <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
                Dán token thủ công (phương án dự phòng)
            </summary>
            <div className="mt-4 flex flex-col gap-6">{children}</div>
        </details>
    );
}

const EXPIRY_NOTE: Record<'expiring' | 'expired', string> = {
    expiring: 'Token sắp hết hạn, hãy đăng nhập lại để gia hạn.',
    expired: 'Token đã hết hạn, hãy đăng nhập lại để tiếp tục đăng bài.',
};

function IntegrationForm({
    integration,
    onSettled,
}: {
    integration: IntegrationPage;
    onSettled: () => void;
}) {
    const confirm = useConfirm();
    const form = useForm<FormData>({
        fields: Object.fromEntries(
            integration.fields
                .filter((field) => field.type !== 'secret')
                .map((field) => [field.key, field.value ?? '']),
        ),
        secrets: {},
        permissions: integration.permissions
            .filter((permission) => permission.checked)
            .map((permission) => permission.key),
        risk_acknowledged: integration.risk_acknowledged,
    });
    const [working, setWorking] = useState(false);

    const routeArgs = { provider: integration.key };
    // * Inertia types nested error keys loosely; the server keys them `fields.<key>` / `secrets.<key>`.
    const errorOf = (key: string): string | undefined =>
        (form.errors as Record<string, string | undefined>)[key];

    // * The risk checkbox is required for a personal-account provider, or when a flagged scope/field is in use.
    const needsRiskAck =
        integration.unofficial ||
        integration.permissions.some(
            (permission) =>
                permission.unofficial &&
                form.data.permissions.includes(permission.key),
        ) ||
        integration.fields.some(
            (field) =>
                field.unofficial &&
                (
                    (field.type === 'secret'
                        ? form.data.secrets[field.key]
                        : form.data.fields[field.key]) ?? ''
                ).trim() !== '',
        );

    const setField = (key: string, value: string) =>
        form.setData('fields', { ...form.data.fields, [key]: value });
    const setSecret = (key: string, value: string) =>
        form.setData('secrets', { ...form.data.secrets, [key]: value });
    const togglePermission = (key: string, checked: boolean) =>
        form.setData(
            'permissions',
            checked
                ? [...form.data.permissions, key]
                : form.data.permissions.filter((item) => item !== key),
        );

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.put(update.url(routeArgs), {
            preserveScroll: true,
            onSuccess: onSettled,
        });
    };

    const runAction = (send: () => void) => {
        setWorking(true);
        send();
    };

    const handleTest = () =>
        runAction(() =>
            router.post(
                test.url(routeArgs),
                {},
                {
                    preserveScroll: true,
                    onFinish: () => setWorking(false),
                },
            ),
        );

    const handleDisconnect = async () => {
        const ok = await confirm({
            title: `Ngắt kết nối ${integration.name}?`,
            description:
                'Khoá và token đã lưu sẽ bị xoá. Bạn có thể kết nối lại bất cứ lúc nào.',
            confirmLabel: 'Ngắt kết nối',
            destructive: true,
        });

        if (ok) {
            runAction(() =>
                router.delete(destroy.url(routeArgs), {
                    preserveScroll: true,
                    onSuccess: onSettled,
                    onFinish: () => setWorking(false),
                }),
            );
        }
    };

    const busy = form.processing || working;
    const oauth = integration.login === 'oauth' ? integration.oauth : null;

    const handleOAuthLogin = () =>
        runAction(() =>
            router.post(
                startLinkedIn.url(),
                {},
                { onFinish: () => setWorking(false) },
            ),
        );

    return (
        <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:p-6">
            <form onSubmit={submit} className="flex min-w-0 flex-col gap-6">
                <div className="flex flex-col gap-2">
                    <Link
                        href={index.url()}
                        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft aria-hidden="true" className="size-4" />
                        Tích hợp
                    </Link>
                    <h1 className="text-xl font-semibold">
                        Kết nối {integration.name}
                    </h1>
                </div>

                {!integration.active && (
                    <Alert role="note">
                        <AlertTriangle aria-hidden="true" />
                        <span>
                            Kênh này chưa hoạt động; bạn có thể lưu trước cấu
                            hình, chưa nhận/gửi được tin.
                        </span>
                    </Alert>
                )}

                {integration.status === 'error' && integration.last_error && (
                    <Alert variant="destructive" role="alert">
                        <AlertTriangle aria-hidden="true" />
                        <span>{integration.last_error}</span>
                    </Alert>
                )}

                {needsRiskAck && (
                    <Alert role="note" className="border-destructive/50">
                        <AlertTriangle aria-hidden="true" />
                        <span>{integration.unofficial_warning}</span>
                    </Alert>
                )}

                {needsRiskAck && (
                    <div className="grid gap-2">
                        <div className="flex items-start gap-3">
                            <Checkbox
                                id="integration-risk"
                                className="mt-0.5"
                                checked={form.data.risk_acknowledged}
                                onCheckedChange={(checked) =>
                                    form.setData(
                                        'risk_acknowledged',
                                        checked === true,
                                    )
                                }
                                aria-invalid={!!errorOf('risk_acknowledged')}
                            />
                            <Label htmlFor="integration-risk">
                                Tôi hiểu rủi ro
                            </Label>
                        </div>
                        <InputError message={errorOf('risk_acknowledged')} />
                    </div>
                )}

                {oauth && (
                    <Card>
                        <CardHeader className="border-b">
                            <CardTitle>Đăng nhập {integration.name}</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            {oauth.expiry && oauth.expiry !== 'ok' && (
                                <Alert
                                    variant={
                                        oauth.expiry === 'expired'
                                            ? 'destructive'
                                            : undefined
                                    }
                                    role="alert"
                                >
                                    <AlertTriangle aria-hidden="true" />
                                    <span>{EXPIRY_NOTE[oauth.expiry]}</span>
                                </Alert>
                            )}
                            <div>
                                <Button
                                    type="button"
                                    disabled={busy || !oauth.configured}
                                    onClick={handleOAuthLogin}
                                >
                                    Đăng nhập với LinkedIn
                                </Button>
                            </div>
                            {!oauth.configured && (
                                <p className="text-xs text-muted-foreground">
                                    Chưa cấu hình ứng dụng LinkedIn: đặt
                                    LINKEDIN_CLIENT_ID và LINKEDIN_CLIENT_SECRET
                                    trong .env rồi tải lại cấu hình (xem mục
                                    &quot;Cách kết nối&quot;).
                                </p>
                            )}
                        </CardContent>
                    </Card>
                )}

                <ManualSection collapsible={oauth !== null}>
                    <Card>
                        <CardHeader className="border-b">
                            <CardTitle>Thông tin kết nối</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <p className="text-sm text-muted-foreground">
                                {integration.description}
                            </p>
                            {integration.fields.map((field) => {
                                const id = `integration-${field.key}`;
                                const name =
                                    field.type === 'secret'
                                        ? `secrets.${field.key}`
                                        : `fields.${field.key}`;
                                const error = errorOf(name);
                                const hint = [
                                    field.hint,
                                    field.type === 'secret' && field.mask
                                        ? 'Để trống nếu không đổi'
                                        : null,
                                ]
                                    .filter(Boolean)
                                    .join('. ');

                                return (
                                    <div key={field.key} className="grid gap-2">
                                        <Label htmlFor={id}>
                                            {field.label}
                                            {field.required && (
                                                <span
                                                    aria-hidden="true"
                                                    className="text-destructive"
                                                >
                                                    {' '}
                                                    *
                                                </span>
                                            )}
                                        </Label>
                                        {field.type === 'select' ? (
                                            <Select
                                                value={
                                                    form.data.fields[
                                                        field.key
                                                    ] ?? ''
                                                }
                                                onValueChange={(value) =>
                                                    setField(field.key, value)
                                                }
                                            >
                                                <SelectTrigger
                                                    id={id}
                                                    className="w-full"
                                                    aria-invalid={!!error}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {field.options.map(
                                                        (option) => (
                                                            <SelectItem
                                                                key={
                                                                    option.value
                                                                }
                                                                value={
                                                                    option.value
                                                                }
                                                            >
                                                                {option.label}
                                                            </SelectItem>
                                                        ),
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        ) : field.type === 'secret' ? (
                                            <Input
                                                id={id}
                                                type="password"
                                                autoComplete="new-password"
                                                value={
                                                    form.data.secrets[
                                                        field.key
                                                    ] ?? ''
                                                }
                                                onChange={(event) =>
                                                    setSecret(
                                                        field.key,
                                                        event.target.value,
                                                    )
                                                }
                                                placeholder={
                                                    field.mask ??
                                                    field.placeholder ??
                                                    ''
                                                }
                                                aria-invalid={!!error}
                                                aria-describedby={
                                                    hint
                                                        ? `${id}-hint`
                                                        : undefined
                                                }
                                            />
                                        ) : (
                                            <Input
                                                id={id}
                                                value={
                                                    form.data.fields[
                                                        field.key
                                                    ] ?? ''
                                                }
                                                onChange={(event) =>
                                                    setField(
                                                        field.key,
                                                        event.target.value,
                                                    )
                                                }
                                                placeholder={
                                                    field.placeholder ?? ''
                                                }
                                                aria-invalid={!!error}
                                                aria-describedby={
                                                    hint
                                                        ? `${id}-hint`
                                                        : undefined
                                                }
                                            />
                                        )}
                                        {hint && (
                                            <p
                                                id={`${id}-hint`}
                                                className="text-xs text-muted-foreground"
                                            >
                                                {hint}
                                            </p>
                                        )}
                                        <InputError message={error} />
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="border-b">
                            <CardTitle>Quyền và phạm vi</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            {integration.permissions.map((permission) => {
                                const id = `integration-permission-${permission.key}`;

                                return (
                                    <div
                                        key={permission.key}
                                        className="flex items-start gap-3 rounded-md border p-3"
                                    >
                                        <Checkbox
                                            id={id}
                                            className="mt-0.5"
                                            checked={form.data.permissions.includes(
                                                permission.key,
                                            )}
                                            onCheckedChange={(checked) =>
                                                togglePermission(
                                                    permission.key,
                                                    checked === true,
                                                )
                                            }
                                        />
                                        <Label
                                            htmlFor={id}
                                            className="flex flex-col items-start gap-0.5 font-normal"
                                        >
                                            <span>{permission.label}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {permission.description}
                                            </span>
                                        </Label>
                                    </div>
                                );
                            })}
                            <InputError message={errorOf('permissions')} />
                        </CardContent>
                    </Card>
                </ManualSection>

                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy}>
                        {form.processing
                            ? 'Đang lưu...'
                            : integration.save_label}
                    </Button>
                    {integration.can_test && (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={handleTest}
                        >
                            Kiểm tra kết nối
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={onSettled}
                    >
                        Huỷ
                    </Button>
                    {integration.status !== 'disconnected' && (
                        <Button
                            type="button"
                            variant="outline"
                            className="border-destructive text-destructive hover:text-destructive"
                            disabled={busy}
                            onClick={handleDisconnect}
                        >
                            Ngắt kết nối
                        </Button>
                    )}
                </div>
            </form>

            <aside aria-label="Hỗ trợ" className="flex flex-col gap-6">
                {GROUP_PROVIDERS.includes(integration.key) && (
                    <SocialGroupsCard provider={integration.key} />
                )}
                <Card>
                    <CardHeader className="border-b">
                        <CardTitle>Trạng thái</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                            <span>Kết nối</span>
                            <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                    integration.status === 'connected' &&
                                    !integration.active
                                        ? SAVED_CONFIG_STYLE
                                        : STATUS_STYLE[integration.status]
                                }`}
                            >
                                {integration.status_label}
                            </span>
                        </div>
                        {integration.account_name && (
                            <div className="flex items-center justify-between gap-2">
                                <span>Tài khoản</span>
                                <span className="font-medium">
                                    {integration.account_name}
                                </span>
                            </div>
                        )}
                        {oauth && (
                            <div className="flex items-center justify-between gap-2">
                                <span>Token</span>
                                <span className="text-right font-medium">
                                    {oauth.expiry === 'expired'
                                        ? 'Hết hạn'
                                        : oauth.expires_at
                                          ? `Hết hạn ${formatDateTime(oauth.expires_at)}`
                                          : 'Dán thủ công, không rõ hạn'}
                                </span>
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                            {integration.last_checked_at
                                ? `Kiểm tra lần cuối: ${formatDateTime(integration.last_checked_at)}`
                                : 'Chưa kiểm tra kết nối.'}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="border-b">
                        <CardTitle>Cách kết nối</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ol className="list-decimal space-y-1 pl-5 text-sm">
                            {integration.steps.map((step) => (
                                <li key={step}>{step}</li>
                            ))}
                        </ol>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="border-b">
                        <CardTitle>Bảo mật</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                            {integration.security_notes.map((note) => (
                                <li key={note}>{note}</li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            </aside>
        </div>
    );
}

export default function IntegrationShow({
    integration,
}: {
    integration: IntegrationPage;
}) {
    // * Remounting drops unsaved edits and typed secrets: after a save, on Huỷ, and when switching provider.
    const [version, setVersion] = useState(0);

    return (
        <>
            <Head title={`Tích hợp / ${integration.name}`} />
            <IntegrationForm
                key={`${integration.key}-${version}`}
                integration={integration}
                onSettled={() => setVersion((current) => current + 1)}
            />
        </>
    );
}
