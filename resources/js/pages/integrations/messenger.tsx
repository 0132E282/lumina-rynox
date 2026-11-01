import { Head, Link, router } from '@inertiajs/react';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm-dialog';
import { MessengerAccountDialog } from '@/components/integrations/messenger-account-dialog';
import { IntegrationAccountsTable } from '@/components/integrations/integration-accounts-table';
import {
    destroy as destroyAccount,
    forget as forgetAccount,
} from '@/actions/App/Http/Controllers/MessengerAccountController';
import { index } from '@/actions/App/Http/Controllers/IntegrationController';
import type { IntegrationPage, MessengerAccountSummary } from '@/types';

type DialogState =
    { open: false } | { open: true; account: MessengerAccountSummary | null };

/** * Own page for the Messenger channel: accounts are set up one by one in a dialog, nothing is saved at channel level. */
export default function MessengerIntegration({
    integration,
}: {
    integration: IntegrationPage;
}) {
    const confirm = useConfirm();
    const [dialog, setDialog] = useState<DialogState>({ open: false });
    const [working, setWorking] = useState(false);

    const disconnect = async (account: MessengerAccountSummary) => {
        const ok = await confirm({
            title: `Ngắt kết nối ${account.name ?? 'tài khoản này'}?`,
            description:
                'Tài khoản này bị ngắt và toàn bộ hội thoại, tin nhắn của nó bị xoá vĩnh viễn. Các tài khoản khác giữ nguyên.',
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

    const remove = async (account: MessengerAccountSummary) => {
        const ok = await confirm({
            title: `Xóa ${account.name ?? 'tài khoản này'}?`,
            description:
                'Tài khoản đã ngắt kết nối này sẽ bị xoá khỏi danh sách. Muốn dùng lại phải thêm tài khoản bằng cookie mới.',
            confirmLabel: 'Xóa',
            destructive: true,
        });

        if (ok) {
            setWorking(true);
            router.delete(forgetAccount.url(account.id), {
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
                    fallbackName="Tài khoản Facebook"
                    fallbackInitials="FB"
                    emptyMessage={
                        'Chưa có tài khoản Messenger nào. Bấm "Thêm tài khoản" rồi dán cookie facebook.com để đăng nhập.'
                    }
                    onAdd={() => setDialog({ open: true, account: null })}
                    onSettings={(account) => setDialog({ open: true, account })}
                    onDisconnect={(account) => void disconnect(account)}
                    onReconnect={() => setDialog({ open: true, account: null })}
                    onDelete={(account) => void remove(account)}
                />
            </div>

            {dialog.open && (
                // * Keyed by account so the form (and any typed cookie) starts clean every time the dialog opens.
                <MessengerAccountDialog
                    key={dialog.account?.id ?? 'new'}
                    open
                    account={dialog.account}
                    permissions={integration.account_permissions}
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
