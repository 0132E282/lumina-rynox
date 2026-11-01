import { Head, Link, router } from '@inertiajs/react';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm-dialog';
import { AiAccountDialog } from '@/components/integrations/ai-account-dialog';
import { AiAccountsTable } from '@/components/integrations/ai-accounts-table';
import {
    destroy as destroyAccount,
    test as testAccount,
    toggle,
} from '@/actions/App/Http/Controllers/AiAccountController';
import { index } from '@/actions/App/Http/Controllers/IntegrationController';
import type { AiAccountSummary, IntegrationPage } from '@/types';

type DialogState =
    { open: false } | { open: true; account: AiAccountSummary | null };

/** * Own page for the AI provider: several accounts (API token or CLI session token) tried by priority; nothing here sends messages to customers. */
export default function AiIntegration({
    integration,
}: {
    integration: IntegrationPage;
}) {
    const confirm = useConfirm();
    const [dialog, setDialog] = useState<DialogState>({ open: false });
    const [working, setWorking] = useState(false);
    const options = integration.ai_options;

    const run = (visit: (onFinish: () => void) => void) => {
        setWorking(true);
        visit(() => setWorking(false));
    };

    const remove = async (account: AiAccountSummary) => {
        const ok = await confirm({
            title: `Xoá tài khoản ${account.name}?`,
            description: 'Token đã lưu sẽ bị xoá và không khôi phục được.',
            confirmLabel: 'Xoá',
            destructive: true,
        });

        if (ok) {
            run((onFinish) =>
                router.delete(destroyAccount.url(account.id), {
                    preserveScroll: true,
                    onFinish,
                }),
            );
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
                    <h1 className="text-xl font-semibold">
                        {integration.name}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {integration.description}
                    </p>
                </div>

                {options !== null && (
                    <AiAccountsTable
                        accounts={integration.ai_accounts}
                        options={options}
                        disabled={working}
                        onAdd={() => setDialog({ open: true, account: null })}
                        onEdit={(account) => setDialog({ open: true, account })}
                        onToggle={(account) =>
                            run((onFinish) =>
                                router.post(
                                    toggle.url(account.id),
                                    {},
                                    { preserveScroll: true, onFinish },
                                ),
                            )
                        }
                        onTest={(account) =>
                            run((onFinish) =>
                                router.post(
                                    testAccount.url(account.id),
                                    {},
                                    { preserveScroll: true, onFinish },
                                ),
                            )
                        }
                        onDelete={(account) => void remove(account)}
                    />
                )}
            </div>

            {dialog.open && options !== null && (
                // * Keyed by account so the form (and any typed token) starts clean every time the dialog opens.
                <AiAccountDialog
                    key={dialog.account?.id ?? 'new'}
                    account={dialog.account}
                    options={options}
                    onClose={() => setDialog({ open: false })}
                />
            )}
        </>
    );
}
