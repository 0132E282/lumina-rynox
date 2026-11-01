import { router } from '@inertiajs/react';
import { useState } from 'react';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { CliLogin } from '@/components/integrations/cli-login';
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
    store,
    update,
} from '@/actions/App/Http/Controllers/AiAccountController';
import type { AiAccountSummary, AiOptions } from '@/types';

type Errors = Record<string, string | undefined>;

/**
 * Add or edit ONE AI account. The token is write-only: while editing it starts empty and a blank value keeps the stored one.
 * Ticking every purpose (or none) means "all purposes".
 */
export function AiAccountDialog({
    account,
    options,
    onClose,
}: {
    account: AiAccountSummary | null;
    options: AiOptions;
    onClose: () => void;
}) {
    const [name, setName] = useState(account?.name ?? '');
    const [vendor, setVendor] = useState(account?.vendor ?? 'anthropic');
    const [authType, setAuthType] = useState(account?.auth_type ?? 'api_token');
    const [token, setToken] = useState('');
    const [model, setModel] = useState(account?.model ?? '');
    const [priority, setPriority] = useState(String(account?.priority ?? 100));
    const [purposes, setPurposes] = useState<string[]>(
        account?.purposes ?? options.purposes.map((purpose) => purpose.value),
    );
    const [errors, setErrors] = useState<Errors>({});
    const [submitting, setSubmitting] = useState(false);

    const togglePurpose = (key: string, checked: boolean) =>
        setPurposes((current) =>
            checked
                ? [...current, key]
                : current.filter((item) => item !== key),
        );

    const submit = () => {
        const data = {
            name,
            vendor,
            auth_type: authType,
            token,
            model,
            priority: Number(priority),
            purposes,
        };
        const visitOptions = {
            preserveScroll: true,
            onSuccess: onClose,
            onError: (caught: Errors) => setErrors(caught),
            onFinish: () => {
                // * The token is never kept in state once the request settles.
                setToken('');
                setSubmitting(false);
            },
        };

        setSubmitting(true);
        setErrors({});

        if (account === null) {
            router.post(store.url(), data, visitOptions);
        } else {
            router.put(update.url(account.id), data, visitOptions);
        }
    };

    const idPrefix = `ai-account-${account?.id ?? 'new'}`;

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {account === null
                            ? 'Thêm tài khoản AI'
                            : 'Sửa tài khoản AI'}
                    </DialogTitle>
                    <DialogDescription>
                        Token được lưu mã hoá và không hiển thị lại. AI chỉ tự
                        gửi tin cho khách khi bạn bật công tắc “Trả lời tự
                        động”.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor={`${idPrefix}-name`}>Tên gọi</Label>
                        <Input
                            id={`${idPrefix}-name`}
                            value={name}
                            maxLength={100}
                            onChange={(event) => setName(event.target.value)}
                            aria-invalid={!!errors.name}
                        />
                        <InputError message={errors.name} />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label htmlFor={`${idPrefix}-vendor`}>
                                Nhà cung cấp
                            </Label>
                            <Select value={vendor} onValueChange={setVendor}>
                                <SelectTrigger
                                    id={`${idPrefix}-vendor`}
                                    className="w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.vendors.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <InputError message={errors.vendor} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor={`${idPrefix}-auth`}>
                                Loại token
                            </Label>
                            <Select
                                value={authType}
                                onValueChange={(value) =>
                                    setAuthType(
                                        value as AiAccountSummary['auth_type'],
                                    )
                                }
                            >
                                <SelectTrigger
                                    id={`${idPrefix}-auth`}
                                    className="w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.auth_types.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <InputError message={errors.auth_type} />
                        </div>
                    </div>

                    {authType === 'session_token' &&
                    (vendor === 'anthropic' || vendor === 'openai') ? (
                        <CliLogin vendor={vendor} />
                    ) : (
                        <div className="grid gap-2">
                            <Label htmlFor={`${idPrefix}-token`}>Token</Label>
                            <Input
                                id={`${idPrefix}-token`}
                                type="password"
                                autoComplete="off"
                                value={token}
                                placeholder={
                                    account?.token_mask ??
                                    'Dán API token hoặc session token'
                                }
                                onChange={(event) =>
                                    setToken(event.target.value)
                                }
                                aria-invalid={!!errors.token}
                            />
                            <p className="text-xs text-muted-foreground">
                                {account === null
                                    ? 'Session token chạy qua CLI claude, codex hoặc gemini trên máy chủ này (DeepSeek chỉ có API token). Với session token, để trống để dùng tài khoản CLI đã đăng nhập sẵn trên máy (chạy claude login, codex login hoặc gemini trong terminal).'
                                    : 'Để trống để giữ token đang lưu.'}
                            </p>
                            <InputError message={errors.token} />
                        </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label htmlFor={`${idPrefix}-model`}>Mô hình</Label>
                            <Input
                                id={`${idPrefix}-model`}
                                value={model}
                                maxLength={100}
                                placeholder="Mặc định của nhà cung cấp"
                                onChange={(event) =>
                                    setModel(event.target.value)
                                }
                                aria-invalid={!!errors.model}
                            />
                            <InputError message={errors.model} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor={`${idPrefix}-priority`}>
                                Ưu tiên (nhỏ chạy trước)
                            </Label>
                            <Input
                                id={`${idPrefix}-priority`}
                                type="number"
                                min={0}
                                max={1000}
                                value={priority}
                                onChange={(event) =>
                                    setPriority(event.target.value)
                                }
                                aria-invalid={!!errors.priority}
                            />
                            <InputError message={errors.priority} />
                        </div>
                    </div>

                    <fieldset className="grid gap-2">
                        <legend className="mb-1 text-sm font-medium">
                            Mục đích sử dụng
                        </legend>
                        {options.purposes.map((purpose) => (
                            <div
                                key={purpose.value}
                                className="flex items-center gap-3"
                            >
                                <Checkbox
                                    id={`${idPrefix}-purpose-${purpose.value}`}
                                    checked={purposes.includes(purpose.value)}
                                    onCheckedChange={(checked) =>
                                        togglePurpose(
                                            purpose.value,
                                            checked === true,
                                        )
                                    }
                                />
                                <Label
                                    htmlFor={`${idPrefix}-purpose-${purpose.value}`}
                                >
                                    {purpose.label}
                                </Label>
                            </div>
                        ))}
                        <InputError message={errors.purposes} />
                    </fieldset>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                        disabled={submitting}
                    >
                        Huỷ
                    </Button>
                    <Button
                        type="button"
                        onClick={submit}
                        disabled={submitting || name.trim() === ''}
                    >
                        Lưu
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
