import { Head, Link, router } from '@inertiajs/react';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm-dialog';
import { IntegrationAccountsTable } from '@/components/integrations/integration-accounts-table';
import { ZaloAccountDialog } from '@/components/integrations/zalo-account-dialog';
import { ZaloContactSyncButton } from '@/components/integrations/zalo-contact-sync-button';
import { destroy as destroyAccount } from '@/actions/App/Http/Controllers/ZaloAccountController';
import { index } from '@/actions/App/Http/Controllers/IntegrationController';
import type { IntegrationAccountSummary, IntegrationPage } from '@/types';

type DialogState =
    { open: false } | { open: true; account: IntegrationAccountSummary | null };

/** * Own page for the Zalo channel: accounts are signed in one by one (QR) in a dialog, nothing is saved at channel level. */
export default function ZaloIntegration({
    integration,
}: {
    integration: IntegrationPage;
}) {
    const confirm = useConfirm();
    const [dialog, setDialog] = useState<DialogState>({ open: false });
    const [working, setWorking] = useState(false);

    const disconnect = async (account: IntegrationAccountSummary) => {
        const ok = await confirm({
            title: `Ngắt kết nối ${account.name ?? 'tài khoản này'}?`,
            description:
                'Chỉ tài khoản này bị ngắt; các tài khoản khác và toàn bộ hội thoại, tin nhắn đã nhận vẫn giữ nguyên.',
            confirmLabel: 'Ngắt kết nối',
            destructive: true,
        });

        if (ok) {
            setWorking(true);
            router.delete(destroyAccount.url(account.id), {
                preserveScroll: true,
                onFinish: () => setWorking(false),
            });
        }
    };

    return (
        <>
            <Head title={`Tích hợp / ${integration.name}`} />
            <div className="flex flex-col gap-6 p-4 lg:p-6">
                <div className="flex flex-col gap-2">
                    <Link
                        href={index.url()}
                        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft aria-hidden="true" className="size-4" />
                        Tích hợp
                    </Link>
                </div>

                <IntegrationAccountsTable
                    accounts={integration.accounts}
                    disabled={working}
                    fallbackName="Tài khoản Zalo"
                    fallbackInitials="ZL"
                    emptyMessage={
                        'Chưa có tài khoản Zalo nào. Bấm "Thêm tài khoản" rồi quét mã QR để đăng nhập.'
                    }
                    onAdd={() => setDialog({ open: true, account: null })}
                    onSettings={(account) => setDialog({ open: true, account })}
                    onDisconnect={(account) => void disconnect(account)}
                    renderExtraActions={(account) =>
                        account.status === 'connected' ? (
                            <ZaloContactSyncButton
                                accountId={account.id}
                                disabled={working}
                            />
                        ) : null
                    }
                />
            </div>

            {dialog.open && (
                // * Keyed by account so scopes and the QR session start clean every time the dialog opens.
                <ZaloAccountDialog
                    key={dialog.account?.id ?? 'new'}
                    account={dialog.account}
                    permissions={integration.account_permissions}
                    groupModes={integration.account_group_modes}
                    warning={integration.unofficial_warning}
                    steps={integration.steps}
                    onClose={() => setDialog({ open: false })}
                    onLoggedIn={() => {
                        setDialog({ open: false });
                        toast.success(`Đã kết nối ${integration.name}`);
                        router.reload();
                    }}
                />
            )}
        </>
    );
}
