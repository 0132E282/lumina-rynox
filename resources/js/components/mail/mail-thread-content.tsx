import { Link, router } from '@inertiajs/react';
import { Check, CircleAlert, CircleHelp, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { resend, show } from '@/actions/App/Http/Controllers/MailController';
import { useConfirm } from '@/components/confirm-dialog';
import { AttachmentList } from '@/components/mail/attachment-list';
import { MailBody } from '@/components/mail/mail-body';
import { ReplyComposer } from '@/components/mail/reply-composer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatDateTimePersonal } from '@/lib/personal-date';
import { cn } from '@/lib/utils';
import type {
    MailAddress,
    MailMessageDetail,
    MailOutboxItem,
    MailShowProps,
} from '@/types';

const formatAddress = (address: MailAddress) =>
    address.name ? `${address.name} <${address.email}>` : address.email;

function ThreadMessage({
    message,
    initialShowImages,
}: {
    message: MailMessageDetail;
    initialShowImages: boolean;
}) {
    return (
        <Card className={cn('gap-0 py-0', message.current && 'border-primary')}>
            <CardHeader className="gap-1 border-b py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                        {message.role === 'sent'
                            ? 'Bạn'
                            : (message.from_name ?? message.from_email)}
                        {message.role !== 'sent' && message.from_name && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                                {message.from_email}
                            </span>
                        )}
                    </span>
                    {message.received_at && (
                        <span className="text-xs text-muted-foreground">
                            {formatDateTimePersonal(message.received_at)}
                        </span>
                    )}
                </div>
                <div className="text-xs text-muted-foreground">
                    Tới: {message.to.map(formatAddress).join(', ') || '—'}
                    {message.cc.length > 0 &&
                        ` · Cc: ${message.cc.map(formatAddress).join(', ')}`}
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 py-4">
                {message.body_loaded ? (
                    <MailBody
                        html={message.body_html}
                        text={message.body_text}
                        snippet={message.snippet}
                        truncated={message.body_truncated}
                        initialShowImages={initialShowImages}
                    />
                ) : (
                    <div className="flex flex-col items-start gap-1 text-sm text-muted-foreground">
                        <span>{message.snippet}</span>
                        {!message.current && (
                            <Link
                                href={show.url({ message: message.id })}
                                className="text-primary underline"
                            >
                                Mở thư để tải nội dung
                            </Link>
                        )}
                    </div>
                )}
                <AttachmentList attachments={message.attachments} />
            </CardContent>
        </Card>
    );
}

function OutboxRow({
    item,
    canSend,
    fromInbox,
}: {
    item: MailOutboxItem;
    canSend: boolean;
    fromInbox: boolean;
}) {
    const confirm = useConfirm();
    const [busy, setBusy] = useState(false);

    const doResend = async () => {
        // * "unknown": the first send may have gone out, so the user must confirm a possible duplicate.
        if (
            item.status === 'unknown' &&
            !(await confirm({
                title: 'Gửi lại thư?',
                description:
                    'Có thể gửi trùng: thư trước đó có thể đã được gửi đi. Hãy kiểm tra thư mục Đã gửi trên webmail trước.',
                confirmLabel: 'Gửi lại',
            }))
        ) {
            return;
        }

        setBusy(true);
        router.post(
            resend.url({ outbox: item.id }),
            fromInbox ? { from_inbox: true } : {},
            { preserveScroll: true, onFinish: () => setBusy(false) },
        );
    };

    return (
        <li className="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate font-medium">
                    Tới {item.to.join(', ')}
                </span>
                <span
                    aria-live="polite"
                    className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                >
                    {item.status === 'sending' && (
                        <>
                            <Loader2
                                aria-hidden="true"
                                className="size-3 motion-safe:animate-spin"
                            />
                            Đang gửi…
                        </>
                    )}
                    {item.status === 'sent' && (
                        <>
                            <Check aria-hidden="true" className="size-3" />
                            Đã gửi
                            {item.sent_copy_saved === false &&
                                ' (chưa lưu được bản sao vào Đã gửi)'}
                        </>
                    )}
                    {item.status === 'unknown' && (
                        <>
                            <CircleHelp
                                aria-hidden="true"
                                className="size-3 text-amber-600"
                            />
                            Chưa chắc chắn
                        </>
                    )}
                    {item.status === 'failed' && (
                        <>
                            <CircleAlert
                                aria-hidden="true"
                                className="size-3 text-destructive"
                            />
                            Gửi lỗi{item.error ? `: ${item.error}` : ''}
                        </>
                    )}
                    {canSend &&
                        (item.status === 'unknown' ||
                            item.status === 'failed') && (
                            <Button
                                type="button"
                                variant="link"
                                className="h-auto p-0 text-xs"
                                disabled={busy}
                                onClick={doResend}
                            >
                                {item.status === 'unknown'
                                    ? 'Gửi lại'
                                    : 'Thử lại'}
                            </Button>
                        )}
                </span>
            </div>
            <p className="line-clamp-2 whitespace-pre-wrap text-muted-foreground">
                {item.body_text}
            </p>
        </li>
    );
}

/**
 * * The body of an opened mail: the whole thread, the reply attempts and the reply form. Shared by `/mail/messages/{id}` and the unified inbox;
 * * `fromInbox` makes reply/resend return to the inbox instead of the mail screens.
 */
export function MailThreadContent({
    thread,
    outbox,
    mailbox,
    reply_defaults,
    show_images,
    can,
    messageId,
    fromInbox = false,
}: Pick<
    MailShowProps,
    'thread' | 'outbox' | 'mailbox' | 'reply_defaults' | 'show_images' | 'can'
> & { messageId: number; fromInbox?: boolean }) {
    return (
        <>
            {thread.map((item) => (
                <ThreadMessage
                    key={item.id}
                    message={item}
                    initialShowImages={show_images}
                />
            ))}

            {outbox.length > 0 && (
                <section className="grid gap-2">
                    <h2 className="font-semibold">Thư trả lời từ ứng dụng</h2>
                    <ul className="grid gap-2">
                        {outbox.map((item) => (
                            <OutboxRow
                                key={item.id}
                                item={item}
                                canSend={can.send}
                                fromInbox={fromInbox}
                            />
                        ))}
                    </ul>
                </section>
            )}

            {can.send && (
                <ReplyComposer
                    key={messageId}
                    messageId={messageId}
                    mailboxEmail={mailbox.email}
                    defaults={reply_defaults}
                    fromInbox={fromInbox}
                />
            )}
        </>
    );
}
