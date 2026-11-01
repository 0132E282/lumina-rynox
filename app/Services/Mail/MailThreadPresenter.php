<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Models\MailFolder;
use App\Models\MailMessage;
use App\Models\MailOutbox;
use App\Support\ResourcePermission;
use Illuminate\Http\Request;
use Inertia\Inertia;

/**
 * * Opens a message and builds the props of its thread (messages, reply attempts, reply defaults). Shared by `/mail/messages/{id}` and `/inbox`
 * * so both open mail identically: the body is fetched from the server once and the message is marked read.
 */
final class MailThreadPresenter
{
    private const THREAD_LIMIT = 50;

    public function __construct(private readonly MailBodyLoader $loader) {}

    /** @return array<string, mixed> */
    public function props(Request $request, MailMessage $message): array
    {
        $result = $this->loader->open($message);

        if ($result->failed()) {
            Inertia::flash('toast', ['type' => 'error', 'message' => (string) $result->error]);
        } elseif (! $result->flagsSynced) {
            Inertia::flash('toast', ['type' => 'info', 'message' => 'Chưa cập nhật được trạng thái đã đọc trên máy chủ, sẽ thử lại ở lần đồng bộ sau.']);
        }

        $message->load('mailbox:id,email,save_sent_copy', 'folder:id,role');

        $thread = MailMessage::query()
            ->where('mailbox_id', $message->mailbox_id)
            ->where('thread_key', $message->thread_key)
            ->with('folder:id,role')
            ->orderBy('received_at')
            ->orderBy('id')
            ->limit(self::THREAD_LIMIT)
            ->get();
        $threadIds = $thread->pluck('id')->all();

        // * A `sending` attempt older than the limit means the request died mid-send: the outcome is unknown, resend asks for confirmation.
        MailOutbox::query()
            ->where('mailbox_id', $message->mailbox_id)
            ->whereIn('reply_to_message_id', $threadIds)
            ->where('status', MailOutbox::STATUS_SENDING)
            ->where('updated_at', '<=', now()->subMinutes(MailOutbox::STALE_SENDING_MINUTES))
            ->update(['status' => MailOutbox::STATUS_UNKNOWN, 'error' => 'Không nhận được phản hồi từ máy chủ, thư có thể đã được gửi.']);

        $outbox = MailOutbox::query()
            ->where('mailbox_id', $message->mailbox_id)
            ->whereIn('reply_to_message_id', $threadIds)
            ->orderBy('id')
            ->get();

        return [
            'message' => $this->presentMessage($message),
            'thread' => $thread->map(fn (MailMessage $item): array => $this->presentMessage($item, $item->is($message)))->all(),
            'outbox' => $outbox->map(fn (MailOutbox $item): array => $this->presentOutbox($item))->all(),
            'mailbox' => ['id' => $message->mailbox_id, 'email' => $message->mailbox->email, 'save_sent_copy' => $message->mailbox->save_sent_copy],
            'reply_defaults' => ['to' => $this->replyRecipients($message), 'subject' => $this->replySubject($message)],
            'show_images' => $request->boolean('show_images'),
            'can' => ['send' => ResourcePermission::allows($request->user(), 'mail', 'send')],
        ];
    }

    /** @return array<string, mixed> */
    private function presentMessage(MailMessage $message, bool $current = true): array
    {
        return [
            'id' => $message->id,
            'current' => $current,
            'role' => $message->folder->role,
            'from_name' => $message->from_name,
            'from_email' => $message->from_email,
            'to' => $message->to ?? [],
            'cc' => $message->cc ?? [],
            'subject' => $message->subject,
            'snippet' => $message->snippet,
            'received_at' => $message->received_at?->toIso8601String(),
            'seen' => $message->seen,
            'answered' => $message->answered,
            'body_loaded' => $message->body_fetched_at !== null,
            // * Already sanitised by HtmlBodySanitizer before it was stored; the browser still renders it in a sandboxed iframe.
            'body_html' => $message->body_html,
            'body_text' => $message->body_text,
            'body_truncated' => $message->body_truncated,
            'attachments' => $message->attachments ?? [],
        ];
    }

    /** @return array<string, mixed> */
    private function presentOutbox(MailOutbox $outbox): array
    {
        return [
            'id' => $outbox->id,
            'reply_to_message_id' => $outbox->reply_to_message_id,
            'to' => array_column($outbox->to, 'email'),
            'cc' => array_column($outbox->cc ?? [], 'email'),
            'subject' => $outbox->subject,
            'body_text' => $outbox->body_text,
            'status' => $outbox->effectiveStatus(),
            'error' => $outbox->error,
            'sent_copy_saved' => $outbox->sent_copy_saved,
            'sent_at' => $outbox->sent_at?->toIso8601String(),
            'created_at' => $outbox->created_at?->toIso8601String(),
        ];
    }

    /**
     * Reply goes to Reply-To, else From; a reply to one's own sent mail goes to its recipients again.
     *
     * @return list<string>
     */
    private function replyRecipients(MailMessage $message): array
    {
        if ($message->folder->role === MailFolder::ROLE_SENT) {
            $addresses = array_column($message->to ?? [], 'email');
        } else {
            $replyTo = array_column($message->reply_to ?? [], 'email');
            $addresses = $replyTo !== [] ? [$replyTo[0]] : array_filter([$message->from_email]);
        }

        return array_values(array_map('strtolower', array_filter($addresses)));
    }

    private function replySubject(MailMessage $message): string
    {
        $subject = trim((string) $message->subject);

        return preg_match('/^re:/i', $subject) === 1 ? $subject : 'Re: '.$subject;
    }
}
