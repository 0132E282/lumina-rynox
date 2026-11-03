import { router } from '@inertiajs/react';
import { isAxiosError } from 'axios';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { FormProvider, useWatch } from 'react-hook-form';
import { Field } from '@/components/form';
import { AccountPermissionsFieldset } from '@/components/integrations/account-permissions-fieldset';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { update } from '@/actions/App/Http/Controllers/MessengerAccountController';
import { login } from '@/actions/App/Http/Controllers/MessengerLoginController';
import { useAppForm } from '@/hooks/use-app-form';
import { api } from '@/lib/api';
import type {
    MessengerAccountPermission,
    MessengerAccountSummary,
} from '@/types';

const BROWSER_LOGIN_URL = '/integrations/messenger/login/browser';

const RISKS = [
    'Kết nối không chính thức: Facebook có thể yêu cầu xác minh, tạm khoá hoặc khoá tài khoản.',
    'Nên dùng tài khoản phụ và bật xác minh 2 bước.',
    'Cookie là chìa khoá đăng nhập tài khoản: chỉ dán vào app này, không chia sẻ. App không lưu cookie, bridge giữ phiên trên máy chủ của bạn.',
    'Đăng xuất Facebook trên trình duyệt đã lấy cookie có thể làm kênh mất kết nối.',
];

type LoginErrors = {
    cookies?: string[];
    risk_acknowledged?: string[];
    permissions?: string[];
};

/**
 * Setup of ONE Messenger account. Add mode: risk notice, "Tôi hiểu rủi ro", the cookie (sent once, never kept in state
 * after the request settles) and the account's scopes. Edit mode (`account` given): scopes only, no cookie.
 */
export function MessengerAccountDialog({
    open,
    account,
    permissions,
    onClose,
    onLoggedIn,
}: {
    open: boolean;
    account: MessengerAccountSummary | null;
    permissions: MessengerAccountPermission[];
    warning: string;
    steps: string[];
    onClose: () => void;
    onLoggedIn: () => void;
}) {
    const editing = account !== null;
    const [riskAcknowledged, setRiskAcknowledged] = useState(false);
    // * The cookie lives only in this form's field value; it is cleared once the request settles.
    const form = useAppForm<{ cookies: string }>({
        defaultValues: { cookies: '' },
    });
    const cookies = useWatch({ control: form.control, name: 'cookies' });
    const [selected, setSelected] = useState<string[]>(
        account?.permissions ??
            permissions
                .filter((permission) => permission.default)
                .map((permission) => permission.key),
    );
    const [submitting, setSubmitting] = useState(false);
    const [browserLogin, setBrowserLogin] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const toggle = (key: string, checked: boolean) =>
        setSelected((current) =>
            checked
                ? [...current, key]
                : current.filter((item) => item !== key),
        );

    // * `viaBrowser`: no cookie is pasted; the server signs in with the Facebook already logged in this machine's Chrome (a window opens when there is no login yet).
    const submitLogin = async (viaBrowser = false) => {
        setSubmitting(true);
        setBrowserLogin(viaBrowser);
        setError(null);

        try {
            await api.post(
                viaBrowser ? BROWSER_LOGIN_URL : login.url(),
                {
                    ...(viaBrowser
                        ? {}
                        : { cookies: form.getValues('cookies') }),
                    risk_acknowledged: riskAcknowledged,
                    permissions: selected,
                },
                // * A login in the Chrome window can take minutes.
                viaBrowser ? { timeout: 400_000 } : undefined,
            );
            onLoggedIn();
        } catch (caught) {
            const data = isAxiosError(caught)
                ? (caught.response?.data as
                      { message?: string; errors?: LoginErrors } | undefined)
                : undefined;

            setError(
                data?.errors?.cookies?.[0] ??
                    data?.errors?.risk_acknowledged?.[0] ??
                    data?.errors?.permissions?.[0] ??
                    data?.message ??
                    'Đăng nhập thất bại.',
            );
        } finally {
            form.setValue('cookies', '');
            setSubmitting(false);
            setBrowserLogin(false);
        }
    };

    const submitSettings = () => {
        if (account === null) {
            return;
        }

        setSubmitting(true);
        router.put(
            update.url(account.id),
            { permissions: selected },
            {
                preserveScroll: true,
                onSuccess: onClose,
                onFinish: () => setSubmitting(false),
            },
        );
    };

    const canSubmit = editing
        ? !submitting
        : !submitting && riskAcknowledged && cookies.trim() !== '';

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {editing
                            ? `Cài đặt ${account.name ?? 'tài khoản'}`
                            : 'Thêm tài khoản Messenger'}
                    </DialogTitle>
                    <DialogDescription>
                        {editing
                            ? 'Quyền và phạm vi chỉ áp dụng cho tài khoản này.'
                            : 'Đăng nhập một tài khoản Facebook bằng cookie, hoặc mở trình duyệt để đăng nhập rồi tự lấy cookie. Các tài khoản khác giữ nguyên.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {!editing && (
                        <>
                            <FormProvider {...form}>
                                <Field
                                    name="cookies"
                                    ui="input"
                                    label="Chuỗi cookie facebook.com"
                                    type="password"
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="c_user=...; xs=...; datr=...; sb=..."
                                    aria-invalid={!!error}
                                    disabled={submitting}
                                    className="gap-2"
                                />
                            </FormProvider>
                            <Collapsible>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-3">
                                        <Checkbox
                                            id="messenger-risk"
                                            checked={riskAcknowledged}
                                            onCheckedChange={(checked) =>
                                                setRiskAcknowledged(
                                                    checked === true,
                                                )
                                            }
                                        />
                                        <Label htmlFor="messenger-risk">
                                            Tôi hiểu rủi ro
                                        </Label>
                                    </div>
                                    <CollapsibleTrigger className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                                        <ChevronDown
                                            aria-hidden="true"
                                            className="size-4"
                                        />
                                        Chi tiết rủi ro
                                    </CollapsibleTrigger>
                                </div>
                                <CollapsibleContent>
                                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                        {RISKS.map((risk) => (
                                            <li key={risk}>{risk}</li>
                                        ))}
                                    </ul>
                                </CollapsibleContent>
                            </Collapsible>
                        </>
                    )}

                    {/* * Scopes keep their defaults for a new account; they are only editable afterwards. */}
                    {editing && (
                        <AccountPermissionsFieldset
                            idPrefix="messenger"
                            permissions={permissions}
                            selected={selected}
                            onToggle={toggle}
                        />
                    )}

                    <InputError message={error ?? undefined} />
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Huỷ
                    </Button>
                    {!editing && (
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={submitting || !riskAcknowledged}
                            title="Mở trình duyệt Chrome, đăng nhập Facebook rồi tự lấy cookie"
                            onClick={() => void submitLogin(true)}
                        >
                            {browserLogin
                                ? 'Đang chờ đăng nhập trong Chrome...'
                                : 'Mở trình duyệt để đăng nhập'}
                        </Button>
                    )}
                    <Button
                        type="button"
                        disabled={!canSubmit}
                        onClick={() =>
                            editing ? submitSettings() : void submitLogin()
                        }
                    >
                        {editing
                            ? submitting
                                ? 'Đang lưu...'
                                : 'Lưu'
                            : submitting && !browserLogin
                              ? 'Đang đăng nhập...'
                              : 'Đăng nhập'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
