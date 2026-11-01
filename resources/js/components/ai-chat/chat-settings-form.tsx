import { isAxiosError } from 'axios';
import { SlidersHorizontal, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { FormProvider } from 'react-hook-form';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { router } from '@inertiajs/react';
import { settings as aiSettingsRoute } from '@/actions/App/Http/Controllers/AiAccountController';
import { ChatSettingsAdvanced } from '@/components/ai-chat/chat-settings-advanced';
import { ChatSettingsPersona } from '@/components/ai-chat/chat-settings-persona';
import type { PersonaErrors } from '@/components/ai-chat/chat-settings-persona';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { useAppForm } from '@/hooks/use-app-form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import type {
    AiChatAccount,
    AiChatAccountList,
    AiChatPurposeChoice,
    AiChatSelection,
    AiChatSettings,
} from '@/types';

type TabKey = 'persona' | 'advanced';

type TextFields = {
    custom_instructions: string;
    display_name: string;
    assistant_name: string;
};

const isTextField = (key: string): key is keyof TextFields =>
    key === 'custom_instructions' ||
    key === 'display_name' ||
    key === 'assistant_name';

const textFieldsOf = (settings: AiChatSettings): TextFields => ({
    custom_instructions: settings.custom_instructions ?? '',
    display_name: settings.display_name ?? '',
    assistant_name: settings.assistant_name ?? '',
});

const sameMap = (
    a: Record<string, AiChatPurposeChoice[]>,
    b: Record<string, AiChatPurposeChoice[]>,
) =>
    JSON.stringify(Object.entries(a).sort()) ===
    JSON.stringify(Object.entries(b).sort());

/** * "Cài đặt chat" in two tabs with one shared Lưu/Hủy footer: Lưu sends the character fields and, when changed, the per-purpose accounts; mode and chat account apply at once. */
export function ChatSettingsForm({
    settings,
    accountName,
    aiAccounts,
    accountList,
    selection,
    onSelectionChange,
    vendor,
    onSaved,
    onClose,
}: {
    settings: AiChatSettings;
    /** The account's own name: what the AI uses while "Tên AI gọi bạn" is empty. */
    accountName: string;
    aiAccounts: AiChatAccount[];
    accountList: AiChatAccountList;
    selection: AiChatSelection;
    onSelectionChange: (selection: AiChatSelection) => void;
    vendor?: { key: string; name: string };
    onSaved: (settings: AiChatSettings) => void;
    onClose: () => void;
}) {
    const [tab, setTab] = useState<TabKey>('persona');
    // * Text fields live in the shared form (Field + FormProvider); the icon and colour buttons keep `draft`.
    const form = useAppForm<TextFields>({
        defaultValues: textFieldsOf(settings),
    });
    const [draft, setDraft] = useState<AiChatSettings>(settings);
    const [purposeDraft, setPurposeDraft] = useState<
        Record<string, AiChatPurposeChoice[]>
    >(accountList.purpose_accounts);
    const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
    const [errors, setErrors] = useState<PersonaErrors>({});
    const [purposeError, setPurposeError] = useState<string | undefined>();

    const set = <Key extends keyof AiChatSettings>(
        key: Key,
        value: AiChatSettings[Key],
    ) => setDraft((current) => ({ ...current, [key]: value }));

    const personaFailed =
        Object.keys(errors).length > 0 ||
        Object.keys(form.formState.errors).length > 0;
    const advancedFailed = purposeError !== undefined;

    const fail = (caught: unknown) => {
        const data = isAxiosError(caught)
            ? (caught.response?.data as
                  | { message?: string; errors?: Record<string, string[]> }
                  | undefined)
            : undefined;
        const other: Record<string, string> = {};

        // * Text fields show their server error through the shared Field; the rest stay in `errors`.
        Object.entries(data?.errors ?? {}).forEach(([key, messages]) => {
            if (isTextField(key)) {
                form.setError(key, { message: messages[0] });
            } else {
                other[key] = messages[0];
            }
        });

        setErrors(other as PersonaErrors);
        setTab('persona');
        toast.error(data?.message ?? 'Không lưu được cài đặt.');
    };

    /** The per-purpose accounts go through the existing AI settings route (needs integrations.update). */
    const savePurposes = () =>
        new Promise<boolean>((resolve) =>
            router.put(
                aiSettingsRoute.url(),
                { purpose_accounts: purposeDraft },
                {
                    preserveScroll: true,
                    preserveState: true,
                    only: ['aiAccountList'],
                    onError: (formErrors) => {
                        setPurposeError(
                            Object.values(formErrors)[0] ??
                                'Không lưu được lựa chọn theo mục đích.',
                        );
                        setTab('advanced');
                        resolve(false);
                    },
                    onSuccess: () => resolve(true),
                },
            ),
        );

    const save = async () => {
        setBusy('save');
        setErrors({});
        form.clearErrors();
        setPurposeError(undefined);

        try {
            const { data } = await api.put<{ settings: AiChatSettings }>(
                '/ai-chat/settings',
                {
                    ...form.getValues(),
                    assistant_icon: draft.assistant_icon,
                    assistant_color: draft.assistant_color,
                },
            );

            onSaved(data.settings);
        } catch (caught) {
            fail(caught);
            setBusy(null);

            return;
        }

        if (
            accountList.can_update &&
            !sameMap(purposeDraft, accountList.purpose_accounts)
        ) {
            if (!(await savePurposes())) {
                setBusy(null);

                return;
            }

            // * The chat purpose now points at an account: the composer follows it (it can still be overridden there).
            const chosen = aiAccounts.find(
                (account) => account.id === purposeDraft.ask?.[0]?.account_id,
            );

            if (chosen) {
                onSelectionChange({
                    accountId: chosen.id,
                    model: purposeDraft.ask?.[0]?.model ?? chosen.model,
                });
            }
        }

        toast.success('Đã lưu cài đặt chat.');
        setBusy(null);
        onClose();
    };

    const reset = async () => {
        setBusy('reset');
        setErrors({});
        form.clearErrors();

        try {
            const { data } = await api.delete<{ settings: AiChatSettings }>(
                '/ai-chat/settings',
            );

            onSaved(data.settings);
            setDraft(data.settings);
            form.reset(textFieldsOf(data.settings));
            toast.success('Đã khôi phục mặc định.');
        } catch (caught) {
            fail(caught);
        } finally {
            setBusy(null);
        }
    };

    // * The settings sections, in sidebar order. Adding one later means adding an entry here.
    const sections: {
        key: TabKey;
        label: string;
        title: string;
        icon: LucideIcon;
        failed: boolean;
        content: ReactNode;
    }[] = [
        {
            key: 'persona',
            label: 'Nhân vật',
            title: 'Cài đặt nhân vật',
            icon: UserRound,
            failed: personaFailed,
            content: (
                <ChatSettingsPersona
                    draft={draft}
                    onChange={set}
                    settings={settings}
                    onSettingsChange={onSaved}
                    accountName={accountName}
                    vendor={vendor}
                    errors={errors}
                    busy={busy !== null}
                    onReset={() => void reset()}
                />
            ),
        },
        {
            key: 'advanced',
            label: 'Nâng cao',
            title: 'Cài đặt nâng cao',
            icon: SlidersHorizontal,
            failed: advancedFailed,
            content: (
                <ChatSettingsAdvanced
                    accountList={accountList}
                    selection={selection}
                    purposeDraft={purposeDraft}
                    onPurposeChange={(purpose, choices) =>
                        setPurposeDraft((current) => {
                            const next = { ...current };

                            if (choices.length === 0) {
                                delete next[purpose];
                            } else {
                                next[purpose] = choices;
                            }

                            return next;
                        })
                    }
                    purposeError={purposeError}
                />
            ),
        },
    ];
    const activeSection =
        sections.find((section) => section.key === tab) ?? sections[0];

    return (
        <FormProvider {...form}>
            <form
                className="flex min-h-0 flex-1 flex-col gap-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                {/* * Settings-style layout: vertical section list on the left (a scrollable row below md), the open section on the right with its own scroll and a fixed Lưu/Hủy footer. */}
                <Tabs
                    orientation="vertical"
                    value={tab}
                    onValueChange={(value) => setTab(value as TabKey)}
                    className="min-h-0 flex-1 gap-3 max-md:flex-col md:flex-row md:gap-6"
                >
                    <TabsList
                        aria-label="Mục cài đặt"
                        className="h-fit shrink-0 gap-1 bg-transparent p-0 max-md:w-full max-md:flex-row! max-md:overflow-x-auto md:w-52"
                    >
                        {sections.map((section) => (
                            <TabsTrigger
                                key={section.key}
                                value={section.key}
                                className="h-9 flex-none justify-start data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none max-md:w-auto! dark:data-[state=active]:bg-accent"
                            >
                                <section.icon aria-hidden="true" />
                                {section.label}
                                {section.failed && <ErrorMark />}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
                        <h3 className="text-base font-semibold">
                            {activeSection.title}
                        </h3>
                        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
                            {sections.map((section) => (
                                <TabsContent
                                    key={section.key}
                                    value={section.key}
                                >
                                    {section.content}
                                </TabsContent>
                            ))}
                        </div>
                        <DialogFooter className="border-t pt-3">
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={busy !== null}
                                onClick={onClose}
                            >
                                Hủy
                            </Button>
                            <Button type="submit" disabled={busy !== null}>
                                {busy === 'save' ? 'Đang lưu...' : 'Lưu'}
                            </Button>
                        </DialogFooter>
                    </div>
                </Tabs>
            </form>
        </FormProvider>
    );
}

function ErrorMark() {
    return (
        <>
            <span
                aria-hidden="true"
                className="ml-1.5 size-1.5 rounded-full bg-destructive"
            />
            <span className="sr-only"> (có lỗi)</span>
        </>
    );
}
