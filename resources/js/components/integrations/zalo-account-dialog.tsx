import { router } from '@inertiajs/react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { AccountPermissionsFieldset } from '@/components/integrations/account-permissions-fieldset';
import { ZaloQrPanel } from '@/components/integrations/zalo-qr-panel';
import { Alert } from '@/components/ui/alert';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { update } from '@/actions/App/Http/Controllers/ZaloAccountController';
import type {
    IntegrationAccountSummary,
    MessengerAccountPermission,
} from '@/types';

const DEFAULT_GROUP_MODE = 'mention_only';

/**
 * Setup of ONE Zalo account. Add mode: the unofficial-connection warning, "Tôi hiểu rủi ro", the account's scopes and group mode,
 * then the QR code. Edit mode (`account` given): scopes and group mode only, no QR.
 */
export function ZaloAccountDialog({
    account,
    permissions,
    groupModes,
    warning,
    steps,
    onClose,
    onLoggedIn,
}: {
    account: IntegrationAccountSummary | null;
    permissions: MessengerAccountPermission[];
    groupModes: { value: string; label: string }[];
    warning: string;
    steps: string[];
    onClose: () => void;
    onLoggedIn: () => void;
}) {
    const editing = account !== null;
    const [riskAcknowledged, setRiskAcknowledged] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [selected, setSelected] = useState<string[]>(
        account?.permissions ??
            permissions
                .filter((permission) => permission.default)
                .map((permission) => permission.key),
    );
    const [groupMode, setGroupMode] = useState(
        account?.group_mode ?? DEFAULT_GROUP_MODE,
    );
    const [submitting, setSubmitting] = useState(false);

    const toggle = (key: string, checked: boolean) =>
        setSelected((current) =>
            checked
                ? [...current, key]
                : current.filter((item) => item !== key),
        );

    const save = () => {
        if (account === null) {
            return;
        }

        setSubmitting(true);
        router.put(
            update.url(account.id),
            { permissions: selected, group_mode: groupMode },
            {
                preserveScroll: true,
                onSuccess: onClose,
                onFinish: () => setSubmitting(false),
            },
        );
    };

    return (
        <Dialog open onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {editing
                            ? `Cài đặt ${account.name ?? 'tài khoản'}`
                            : 'Thêm tài khoản Zalo'}
                    </DialogTitle>
                    <DialogDescription>
                        {editing
                            ? 'Quyền và phạm vi chỉ áp dụng cho tài khoản này.'
                            : scanning
                              ? 'Mở Zalo trên điện thoại > Quét mã QR.'
                              : 'Đăng nhập một tài khoản Zalo bằng mã QR. Các tài khoản khác giữ nguyên.'}
                    </DialogDescription>
                </DialogHeader>

                {scanning ? (
                    <ZaloQrPanel
                        permissions={selected}
                        groupMode={groupMode}
                        onLoggedIn={onLoggedIn}
                    />
                ) : (
                    <div className="flex flex-col gap-4">
                        {!editing && (
                            <>
                                <Alert variant="destructive" role="alert">
                                    <AlertTriangle aria-hidden="true" />
                                    <span>{warning}</span>
                                </Alert>
                                <div className="flex items-start gap-3">
                                    <Checkbox
                                        id="zalo-risk"
                                        className="mt-0.5"
                                        checked={riskAcknowledged}
                                        onCheckedChange={(checked) =>
                                            setRiskAcknowledged(
                                                checked === true,
                                            )
                                        }
                                    />
                                    <Label htmlFor="zalo-risk">
                                        Tôi hiểu rủi ro
                                    </Label>
                                </div>
                                <Collapsible>
                                    <CollapsibleTrigger className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                                        <ChevronDown
                                            aria-hidden="true"
                                            className="size-4"
                                        />
                                        Cách kết nối
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                                            {steps.map((step) => (
                                                <li key={step}>{step}</li>
                                            ))}
                                        </ol>
                                    </CollapsibleContent>
                                </Collapsible>
                            </>
                        )}

                        {/* * Scopes keep their defaults for a new account; they are only editable afterwards. */}
                        {editing && (
                            <AccountPermissionsFieldset
                                idPrefix="zalo"
                                permissions={permissions}
                                selected={selected}
                                onToggle={toggle}
                            />
                        )}

                        {groupModes.length > 0 && (
                            <div className="grid gap-2">
                                <Label htmlFor="zalo-group-mode">
                                    Chế độ nhóm
                                </Label>
                                <Select
                                    value={groupMode}
                                    onValueChange={setGroupMode}
                                >
                                    <SelectTrigger id="zalo-group-mode">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {groupModes.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        {scanning ? 'Đóng' : 'Huỷ'}
                    </Button>
                    {!scanning && (
                        <Button
                            type="button"
                            disabled={editing ? submitting : !riskAcknowledged}
                            onClick={() =>
                                editing ? save() : setScanning(true)
                            }
                        >
                            {editing
                                ? submitting
                                    ? 'Đang lưu...'
                                    : 'Lưu'
                                : 'Quét mã QR'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
