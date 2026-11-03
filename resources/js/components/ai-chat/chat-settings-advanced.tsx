import { Link, router } from '@inertiajs/react';
import { vendorShortName } from '@/lib/ai-account';
import { invalidateAiChatCache } from '@/lib/ai-chat-cache';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toggle } from '@/actions/App/Http/Controllers/AiAccountController';
import { show } from '@/actions/App/Http/Controllers/IntegrationController';
import { VendorBadge } from '@/components/ai-chat/vendor-badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type {
    AiChatAccountList,
    AiChatAccountRow,
    AiChatPurposeChoice,
    AiChatSelection,
} from '@/types';

const MAX_CHOICES = 5;

const STATUS_LABELS: Record<string, string> = {
    connected: 'Kết nối',
    error: 'Lỗi',
    disconnected: 'Chưa kết nối',
};

/** * Tab "Cài đặt nâng cao": the AI accounts with their switches, and which account serves each purpose. */
export function ChatSettingsAdvanced({
    accountList,
    selection,
    purposeDraft,
    onPurposeChange,
    purposeError,
}: {
    accountList: AiChatAccountList;
    /** The composer's current account: only marks the row "đang dùng cho chat". */
    selection: AiChatSelection;
    /** Purpose key => ordered accounts and models (absent = automatic by priority). */
    purposeDraft: Record<string, AiChatPurposeChoice[]>;
    onPurposeChange: (purpose: string, choices: AiChatPurposeChoice[]) => void;
    purposeError?: string;
}) {
    const { accounts, can_update: canUpdate, can_view: canView } = accountList;

    return (
        <div className="flex flex-col gap-5">
            <section
                aria-labelledby="chat-accounts-title"
                className="flex flex-col gap-2"
            >
                <div className="flex items-center justify-between gap-2">
                    <h3
                        id="chat-accounts-title"
                        className="text-sm font-medium"
                    >
                        Tài khoản AI / token
                    </h3>
                    {canView && (
                        <Link
                            href={show.url({ provider: 'ai' })}
                            className="text-xs underline underline-offset-2 hover:text-foreground"
                        >
                            Thêm tài khoản
                        </Link>
                    )}
                </div>
                {accounts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        Chưa có tài khoản AI nào.
                    </p>
                ) : (
                    <ul className="flex flex-col divide-y rounded-md border">
                        {accounts.map((account) => (
                            <li
                                key={account.id}
                                className="flex items-center gap-2 px-3 py-2 text-sm"
                            >
                                <VendorBadge
                                    vendorKey={account.vendor_key}
                                    fallback={account.vendor}
                                    className="size-6"
                                />
                                <span className="min-w-0 flex-1 leading-tight">
                                    <span className="block truncate">
                                        {account.name}
                                    </span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                        {vendorShortName(account.vendor)} · ưu
                                        tiên {account.priority}
                                        {account.id === selection.accountId &&
                                            ' · đang dùng cho chat'}
                                    </span>
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {STATUS_LABELS[account.status] ??
                                        account.status}
                                </span>
                                {canUpdate && (
                                    <Switch
                                        checked={account.enabled}
                                        aria-label={`${account.enabled ? 'Tắt' : 'Bật'} ${account.name}`}
                                        onCheckedChange={() =>
                                            router.post(
                                                toggle.url(account.id),
                                                {},
                                                {
                                                    preserveScroll: true,
                                                    preserveState: true,
                                                    only: [
                                                        'aiAccountList',
                                                        'aiAccounts',
                                                    ],
                                                    onSuccess: () =>
                                                        invalidateAiChatCache(
                                                            'usage',
                                                        ),
                                                },
                                            )
                                        }
                                    />
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section
                aria-labelledby="chat-purposes-title"
                className="flex flex-col gap-2"
            >
                <h3 id="chat-purposes-title" className="text-sm font-medium">
                    Tài khoản theo mục đích
                </h3>
                <div className="flex flex-col gap-3">
                    {accountList.purposes.map((purpose) => (
                        <PurposeCard
                            key={purpose.key}
                            label={purpose.label}
                            accounts={accounts}
                            purposeKey={purpose.key}
                            choices={purposeDraft[purpose.key] ?? []}
                            disabled={!canUpdate}
                            onChange={(choices) =>
                                onPurposeChange(purpose.key, choices)
                            }
                        />
                    ))}
                </div>
                {!canUpdate && (
                    <p className="text-xs text-muted-foreground">
                        Bạn chưa có quyền cập nhật tích hợp nên chỉ xem được;
                        không thể bật/tắt tài khoản hay đổi lựa chọn theo mục
                        đích.
                    </p>
                )}
                {purposeError && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                        {purposeError}
                    </p>
                )}
            </section>
        </div>
    );
}

const samePair = (a: AiChatPurposeChoice, b: AiChatPurposeChoice) =>
    a.account_id === b.account_id && a.model === b.model;

/** Select values cannot be null: these stand for "automatic" and "the account's own model". */
const AUTO = 'auto';
const OWN_MODEL = 'own';

/** A row of the card: no account yet means it is not stored. */
type Row = { account_id: number | null; model: string | null };

const EMPTY_ROW: Row = { account_id: null, model: null };

const complete = (rows: Row[]): AiChatPurposeChoice[] =>
    rows.flatMap((row) =>
        row.account_id === null
            ? []
            : [{ account_id: row.account_id, model: row.model }],
    );

/**
 * One purpose: a compact card with one row per AI to try, in the order listed. Each row is two selects (AI, model) and a delete button; "+" in the header adds a fallback row.
 * Only rows with an AI are stored; an empty card means automatic by priority.
 */
function PurposeCard({
    label,
    purposeKey,
    accounts,
    choices,
    disabled,
    onChange,
}: {
    label: string;
    purposeKey: string;
    accounts: AiChatAccountRow[];
    choices: AiChatPurposeChoice[];
    disabled: boolean;
    onChange: (choices: AiChatPurposeChoice[]) => void;
}) {
    const [rows, setRows] = useState<Row[]>(
        choices.length > 0 ? choices : [EMPTY_ROW],
    );

    // * The stored choices changed from outside (saved, reset): show them. Empty rows the person added meanwhile are not stored, so they never trigger this.
    useEffect(() => {
        setRows((current) =>
            JSON.stringify(complete(current)) === JSON.stringify(choices)
                ? current
                : choices.length > 0
                  ? choices
                  : [EMPTY_ROW],
        );
    }, [choices]);

    const usable = accounts.filter(
        (account) =>
            account.enabled &&
            (account.purposes === null ||
                account.purposes.includes(purposeKey)),
    );
    const modelsOf = (accountId: number) => [
        { id: null as string | null, label: 'Mặc định của tài khoản' },
        ...(accounts.find((account) => account.id === accountId)?.models ?? []),
    ];
    const takenByOther = (index: number, pair: AiChatPurposeChoice) =>
        rows.some(
            (row, position) =>
                position !== index &&
                row.account_id !== null &&
                samePair(
                    { account_id: row.account_id, model: row.model },
                    pair,
                ),
        );

    const apply = (next: Row[]) => {
        setRows(next);
        onChange(complete(next));
    };
    const update = (index: number, row: Row) =>
        apply(rows.map((current, i) => (i === index ? row : current)));

    const pickAccount = (index: number, value: string) => {
        if (value === AUTO) {
            update(index, EMPTY_ROW);

            return;
        }

        const accountId = Number(value);
        const free = modelsOf(accountId).find(
            (model) =>
                !takenByOther(index, {
                    account_id: accountId,
                    model: model.id,
                }),
        );

        // * Every model of this account is already in another row: keep the row as it was.
        if (free !== undefined) {
            update(index, { account_id: accountId, model: free.id });
        }
    };

    const remove = (index: number) =>
        rows.length > 1
            ? apply(rows.filter((_, i) => i !== index))
            : apply([EMPTY_ROW]);

    return (
        <Card className="gap-2 py-3">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
                <CardTitle className="text-sm">{label}</CardTitle>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={
                        disabled ||
                        rows.length >= MAX_CHOICES ||
                        usable.length === 0
                    }
                    aria-label={`Thêm AI dự phòng cho: ${label}`}
                    onClick={() => setRows([...rows, EMPTY_ROW])}
                >
                    <Plus aria-hidden="true" />
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 px-4">
                {rows.map((row, index) => (
                    <div key={index} className="flex items-center gap-2">
                        <Select
                            value={
                                row.account_id === null
                                    ? ''
                                    : String(row.account_id)
                            }
                            disabled={disabled}
                            onValueChange={(value) => pickAccount(index, value)}
                        >
                            <SelectTrigger
                                className="min-w-0 flex-1"
                                aria-label={`AI ${index + 1} của: ${label}`}
                            >
                                <SelectValue placeholder="Chọn AI" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={AUTO}>
                                    Tự động theo ưu tiên
                                </SelectItem>
                                {usable.map((account) => (
                                    <SelectItem
                                        key={account.id}
                                        value={String(account.id)}
                                    >
                                        <span className="flex items-center gap-2">
                                            <VendorBadge
                                                vendorKey={account.vendor_key}
                                                fallback={account.vendor}
                                                className="size-5"
                                            />
                                            {account.name}
                                            {account.status !== 'connected' && (
                                                <span className="text-xs text-destructive">
                                                    (đang lỗi)
                                                </span>
                                            )}
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select
                            value={
                                row.account_id === null
                                    ? ''
                                    : (row.model ?? OWN_MODEL)
                            }
                            disabled={disabled || row.account_id === null}
                            onValueChange={(value) =>
                                update(index, {
                                    account_id: row.account_id,
                                    model: value === OWN_MODEL ? null : value,
                                })
                            }
                        >
                            <SelectTrigger
                                className="min-w-0 flex-1"
                                aria-label={`Model ${index + 1} của: ${label}`}
                            >
                                <SelectValue placeholder="Chọn model" />
                            </SelectTrigger>
                            <SelectContent>
                                {row.account_id !== null &&
                                    modelsOf(row.account_id).map((model) => (
                                        <SelectItem
                                            key={model.id ?? OWN_MODEL}
                                            value={model.id ?? OWN_MODEL}
                                            disabled={takenByOther(index, {
                                                account_id: row.account_id!,
                                                model: model.id,
                                            })}
                                        >
                                            {model.label}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            disabled={disabled}
                            aria-label={`Xóa dòng ${index + 1} của: ${label}`}
                            onClick={() => remove(index)}
                        >
                            <Trash2 aria-hidden="true" />
                        </Button>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
