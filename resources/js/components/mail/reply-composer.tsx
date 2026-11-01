import { useForm } from '@inertiajs/react';
import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { reply } from '@/actions/App/Http/Controllers/MailController';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type ReplyComposerProps = {
    messageId: number;
    mailboxEmail: string;
    defaults: { to: string[]; subject: string };
    /** * Started from the unified inbox: the reply returns there instead of the mail screens. */
    fromInbox?: boolean;
};

type ReplyData = {
    to: string;
    cc: string;
    subject: string;
    body: string;
    client_token: string;
    quote_original: boolean;
};

const splitAddresses = (value: string): string[] =>
    value
        .split(/[,;\s]+/)
        .map((address) => address.trim())
        .filter((address) => address !== '');

/** * Plain-text reply. The token is made here so one click sends once; it is renewed only after the server took the request. */
export function ReplyComposer({
    messageId,
    mailboxEmail,
    defaults,
    fromInbox = false,
}: ReplyComposerProps) {
    const [token, setToken] = useState(() => crypto.randomUUID());
    const form = useForm<ReplyData>({
        to: defaults.to.join(', '),
        cc: '',
        subject: defaults.subject,
        body: '',
        client_token: token,
        quote_original: false,
    });
    const errors = form.errors as Record<string, string | undefined>;
    const firstError = (prefix: string) =>
        errors[prefix] ??
        Object.entries(errors).find(([key]) =>
            key.startsWith(`${prefix}.`),
        )?.[1];
    const canSubmit = form.data.body.trim() !== '' && !form.processing;

    const submit = (event: FormEvent) => {
        event.preventDefault();

        if (!canSubmit) {
            return;
        }

        form.transform((data) => ({
            ...data,
            client_token: token,
            to: splitAddresses(data.to),
            cc: splitAddresses(data.cc),
            ...(fromInbox ? { from_inbox: true } : {}),
        }));
        form.post(reply.url({ message: messageId }), {
            preserveScroll: true,
            onSuccess: () => {
                setToken(crypto.randomUUID());
                form.setData('body', '');
            },
        });
    };

    return (
        <form
            onSubmit={submit}
            className="grid gap-3 rounded-lg border bg-card p-4"
        >
            <h2 className="font-semibold">Trả lời</h2>
            <p className="text-xs text-muted-foreground">
                Gửi từ {mailboxEmail} dạng văn bản thuần.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1">
                    <Label htmlFor="reply-to">Tới</Label>
                    <Input
                        id="reply-to"
                        value={form.data.to}
                        onChange={(event) =>
                            form.setData('to', event.target.value)
                        }
                        aria-invalid={!!firstError('to')}
                    />
                    <InputError message={firstError('to')} />
                </div>
                <div className="grid gap-1">
                    <Label htmlFor="reply-cc">Cc (không bắt buộc)</Label>
                    <Input
                        id="reply-cc"
                        value={form.data.cc}
                        onChange={(event) =>
                            form.setData('cc', event.target.value)
                        }
                        aria-invalid={!!firstError('cc')}
                    />
                    <InputError message={firstError('cc')} />
                </div>
            </div>
            <div className="grid gap-1">
                <Label htmlFor="reply-subject">Tiêu đề</Label>
                <Input
                    id="reply-subject"
                    maxLength={255}
                    value={form.data.subject}
                    onChange={(event) =>
                        form.setData('subject', event.target.value)
                    }
                    aria-invalid={!!errors.subject}
                />
                <InputError message={errors.subject} />
            </div>
            <div className="grid gap-1">
                <Label htmlFor="reply-body">Nội dung</Label>
                <textarea
                    id="reply-body"
                    rows={6}
                    maxLength={100000}
                    value={form.data.body}
                    onChange={(event) =>
                        form.setData('body', event.target.value)
                    }
                    aria-invalid={!!errors.body}
                    className="min-h-32 w-full rounded-sm border border-input bg-card px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
                />
                <InputError message={errors.body} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Checkbox
                        id="reply-quote"
                        checked={form.data.quote_original}
                        onCheckedChange={(value) =>
                            form.setData('quote_original', value === true)
                        }
                    />
                    <Label htmlFor="reply-quote" className="font-normal">
                        Trích dẫn thư gốc
                    </Label>
                </div>
                <Button type="submit" disabled={!canSubmit}>
                    {form.processing ? (
                        <Loader2
                            aria-hidden="true"
                            className="size-4 motion-safe:animate-spin"
                        />
                    ) : (
                        <Send aria-hidden="true" className="size-4" />
                    )}
                    {form.processing ? 'Đang gửi…' : 'Gửi'}
                </Button>
            </div>
        </form>
    );
}
