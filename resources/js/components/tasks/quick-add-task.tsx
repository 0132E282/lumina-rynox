import { isAxiosError } from 'axios';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';

type QuickAddTaskProps = {
    onAdded: () => void;
};

/** * Title-only task creation; priority and status take the column defaults on the server. */
export function QuickAddTask({ onAdded }: QuickAddTaskProps) {
    const [title, setTitle] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();

        const trimmed = title.trim();

        if (!trimmed || submitting) {
            return;
        }

        setSubmitting(true);

        try {
            await api.post(window.route('items.store', { resource: 'tasks' }), {
                title: trimmed,
            });
            setTitle('');
            toast.success('Đã thêm công việc.');
            onAdded();
        } catch (error) {
            const titleError = isAxiosError<{ errors?: { title?: string[] } }>(
                error,
            )
                ? error.response?.data?.errors?.title?.[0]
                : undefined;

            toast.error(titleError ?? 'Không thêm được công việc.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={submit} className="flex items-center gap-2">
            <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={255}
                placeholder="Thêm công việc nhanh..."
                aria-label="Tiêu đề công việc mới"
            />
            <Button type="submit" disabled={!title.trim() || submitting}>
                {submitting ? <Spinner aria-hidden="true" /> : <Plus />}
                Thêm
            </Button>
        </form>
    );
}
