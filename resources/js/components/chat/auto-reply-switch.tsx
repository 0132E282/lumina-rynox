import { router, usePage } from '@inertiajs/react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { autoReply } from '@/actions/App/Http/Controllers/AiController';
import { Switch } from '@/components/ui/switch';
import { aiErrorMessage } from '@/lib/ai-error';
import { api } from '@/lib/api';

// * Last server-side error already toasted, so reopening a conversation does not repeat it.
let notifiedError: string | null = null;

/** * Global ON/OFF switch for automatic customer replies: optimistic, rolled back when the server refuses. */
export function AutoReplySwitch() {
    const { canUseAi, aiAutoReply } = usePage().props;
    const enabled = aiAutoReply.enabled;
    const lastError = aiAutoReply.last_error;
    const labelId = useId();
    const [checked, setChecked] = useState(enabled);
    const [busy, setBusy] = useState(false);

    // * Follows the server value after a navigation or when the server turned the switch off by itself.
    useEffect(() => setChecked(enabled), [enabled]);

    // * The server turned the switch off by itself (e.g. no AI assistant configured): tell the user once.
    useEffect(() => {
        if (!enabled && lastError !== null && lastError !== notifiedError) {
            notifiedError = lastError;
            toast.error(lastError);
        }
    }, [enabled, lastError]);

    if (!canUseAi) {
        return null;
    }

    const change = async (next: boolean) => {
        const previous = checked;
        setChecked(next);
        setBusy(true);

        try {
            await api.post(autoReply.url(), { enabled: next });
            router.reload({ only: ['aiAutoReply'] });
        } catch (caught) {
            setChecked(previous);
            toast.error(aiErrorMessage(caught));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="flex shrink-0 flex-col gap-1 rounded-md border px-3 py-1.5">
            <div className="flex items-center justify-between gap-2">
                <label
                    id={labelId}
                    htmlFor={`${labelId}-switch`}
                    className="text-sm font-medium"
                >
                    Trả lời tự động
                </label>
                <Switch
                    id={`${labelId}-switch`}
                    aria-labelledby={labelId}
                    checked={checked}
                    disabled={busy}
                    onCheckedChange={change}
                />
            </div>
        </section>
    );
}
