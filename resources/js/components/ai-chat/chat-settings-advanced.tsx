import { Link, router } from '@inertiajs/react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { toggle } from '@/actions/App/Http/Controllers/AiAccountController';
import { show } from '@/actions/App/Http/Controllers/IntegrationController';
import { VendorBadge } from '@/components/ai-chat/vendor-badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
                                        {account.vendor.split(' (')[0]} · ưu
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

/**
 * One purpose: a compact card. The header dropdown ("Chọn AI") adds an account + model in one step; the rows below are plain text with a delete button, tried in the order they were added. Empty = automatic by priority.
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
    const usable = accounts.filter(
        (account) =>
            account.enabled &&
            account.status === 'connected' &&
            (account.purposes === null ||
                account.purposes.includes(purposeKey)),
    );
    const full = choices.length >= MAX_CHOICES;
    const taken = (pair: AiChatPurposeChoice) =>
        choices.some((choice) => samePair(choice, pair));
    const modelLabel = (
        account: AiChatAccountRow | undefined,
        id: string | null,
    ) =>
        id === null
            ? 'Mặc định của tài khoản'
            : (account?.models.find((model) => model.id === id)?.label ?? id);

    return (
        <Card className="gap-2 py-3">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
                <CardTitle className="text-sm">{label}</CardTitle>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            disabled={disabled || full || usable.length === 0}
                            aria-label={`Chọn AI cho: ${label}`}
                        >
                            Chọn AI
                            <ChevronDown aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-80">
                        {usable.map((account, index) => (
                            <DropdownMenuGroup key={account.id}>
                                {index > 0 && <DropdownMenuSeparator />}
                                <DropdownMenuLabel>
                                    {account.name}
                                </DropdownMenuLabel>
                                {[
                                    {
                                        id: null,
                                        label: modelLabel(account, null),
                                    },
                                    ...account.models,
                                ].map((model) => (
                                    <DropdownMenuItem
                                        key={model.id ?? 'own'}
                                        disabled={taken({
                                            account_id: account.id,
                                            model: model.id,
                                        })}
                                        onSelect={() =>
                                            onChange([
                                                ...choices,
                                                {
                                                    account_id: account.id,
                                                    model: model.id,
                                                },
                                            ])
                                        }
                                    >
                                        {model.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuGroup>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 px-4">
                {choices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        Tự động theo ưu tiên
                    </p>
                ) : (
                    choices.map((choice, index) => {
                        const account = accounts.find(
                            (row) => row.id === choice.account_id,
                        );

                        return (
                            <div
                                key={`${choice.account_id}|${choice.model ?? ''}`}
                                className="flex items-center gap-2 text-sm"
                            >
                                <span className="min-w-0 flex-1 truncate">
                                    {account?.name ?? `#${choice.account_id}`}
                                    <span className="text-muted-foreground">
                                        {' · '}
                                        {modelLabel(account, choice.model)}
                                    </span>
                                </span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    disabled={disabled}
                                    aria-label={`Xóa dòng ${index + 1} của: ${label}`}
                                    onClick={() =>
                                        onChange(
                                            choices.filter(
                                                (_, i) => i !== index,
                                            ),
                                        )
                                    }
                                >
                                    <Trash2 aria-hidden="true" />
                                </Button>
                            </div>
                        );
                    })
                )}
            </CardContent>
        </Card>
    );
}
