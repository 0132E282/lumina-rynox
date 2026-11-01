import { Head, Link, router } from '@inertiajs/react';
import { ArrowLeft } from 'lucide-react';
import {
    index,
    markUnread,
} from '@/actions/App/Http/Controllers/MailController';
import { MailThreadContent } from '@/components/mail/mail-thread-content';
import { Button, buttonVariants } from '@/components/ui/button';
import { useHeaderActions } from '@/contexts/header-actions';
import { cn } from '@/lib/utils';
import type { MailShowProps } from '@/types';

export default function MailShow({
    message,
    thread,
    outbox,
    mailbox,
    reply_defaults,
    show_images,
    can,
}: MailShowProps) {
    useHeaderActions(
        <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => router.post(markUnread.url({ message: message.id }))}
        >
            Đánh dấu chưa đọc
        </Button>,
        [message.id],
    );

    return (
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4 md:p-6">
            <Head title={message.subject || 'Thư'} />

            <div className="flex flex-col gap-2">
                <Link
                    href={index.url()}
                    className={cn(
                        buttonVariants({ variant: 'ghost', size: 'sm' }),
                        'w-fit',
                    )}
                >
                    <ArrowLeft className="size-4" />
                    Hộp thư
                </Link>
                <h1 className="text-xl font-semibold">
                    {message.subject || '(Không có tiêu đề)'}
                </h1>
                <p className="text-xs text-muted-foreground">
                    Hộp thư {mailbox.email}
                </p>
            </div>

            <MailThreadContent
                thread={thread}
                outbox={outbox}
                mailbox={mailbox}
                reply_defaults={reply_defaults}
                show_images={show_images}
                can={can}
                messageId={message.id}
            />
        </div>
    );
}
