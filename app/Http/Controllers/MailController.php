<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\SendMailRequest;
use App\Models\Admin;
use App\Models\Mailbox;
use App\Models\MailFolder;
use App\Models\MailMessage;
use App\Models\MailOutbox;
use App\Services\Mail\MailBodyLoader;
use App\Services\Mail\MailSender;
use App\Services\Mail\MailThreadPresenter;
use App\Support\ResourcePermission;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Inertia\Inertia;
use Inertia\Response;

/**
 * * Reading, searching and replying to cached mail (`/mail`). Routes carry `mail.{view,send}` middleware (see routes/web.php).
 * * The list never selects bodies; a message body is fetched from the server when the message is opened (MailBodyLoader).
 * ! Nothing here sends mail except `reply`/`resend`, and only on the user's click (BR-002).
 */
class MailController extends Controller
{
    private const PER_PAGE = 50;

    private const TABS = [MailFolder::ROLE_INBOX, MailFolder::ROLE_SENT];

    public function index(Request $request): Response
    {
        $validated = $request->validate([
            'tab' => ['nullable', 'in:'.implode(',', self::TABS)],
            'mailbox' => ['nullable', 'integer', 'min:1'],
            'unread' => ['nullable', 'boolean'],
            'q' => ['nullable', 'string', 'max:100'],
        ]);
        $tab = $validated['tab'] ?? MailFolder::ROLE_INBOX;
        $mailboxId = isset($validated['mailbox']) ? (int) $validated['mailbox'] : null;
        $unread = (bool) ($validated['unread'] ?? false);
        $search = trim((string) ($validated['q'] ?? ''));

        $messages = MailMessage::query()
            ->select(['id', 'mailbox_id', 'mail_folder_id', 'from_name', 'from_email', 'to', 'subject', 'snippet', 'received_at', 'seen', 'has_attachments'])
            ->with('mailbox:id,email')
            ->whereIn('mail_folder_id', MailFolder::query()->where('role', $tab)->select('id'))
            ->when($mailboxId !== null, fn (Builder $query) => $query->where('mailbox_id', $mailboxId))
            ->when($unread, fn (Builder $query) => $query->where('seen', false))
            ->when($search !== '', function (Builder $query) use ($search) {
                // * `!` is the escape character: `\` is not an escape in every database.
                $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%';

                $query->where(fn (Builder $inner) => $inner
                    ->whereRaw("subject like ? escape '!'", [$like])
                    ->orWhereRaw("from_name like ? escape '!'", [$like])
                    ->orWhereRaw("from_email like ? escape '!'", [$like])
                    ->orWhereRaw("snippet like ? escape '!'", [$like]));
            })
            ->orderByDesc('received_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $inbox = MailMessage::query()
            ->whereIn('mail_folder_id', MailFolder::query()->where('role', MailFolder::ROLE_INBOX)->select('id'))
            ->when($mailboxId !== null, fn (Builder $query) => $query->where('mailbox_id', $mailboxId));
        $user = $request->user();

        return Inertia::render('mail/index', [
            'messages' => $this->presentPage($messages, $tab),
            'filters' => ['tab' => $tab, 'mailbox' => $mailboxId, 'unread' => $unread, 'q' => $search],
            'stats' => [
                'unread' => (clone $inbox)->where('seen', false)->count(),
                'attachments' => (clone $inbox)->where('has_attachments', true)->count(),
            ],
            'mailboxes' => Mailbox::query()->orderBy('email')->get(['id', 'email', 'status', 'last_error'])->map(fn (Mailbox $mailbox): array => [
                'id' => $mailbox->id,
                'email' => $mailbox->email,
                'status' => $mailbox->status,
                'status_label' => Mailbox::STATUS_LABELS[$mailbox->status] ?? $mailbox->status,
                'last_error' => $mailbox->last_error,
            ])->all(),
            'can' => ['manage_accounts' => ResourcePermission::allows($user, 'integrations', 'view')],
        ]);
    }

    /** Opens a message: loads its body from the server once, marks it read, and shows the whole thread with its reply attempts. */
    public function show(Request $request, MailMessage $message, MailThreadPresenter $threads): Response
    {
        return Inertia::render('mail/show', $threads->props($request, $message));
    }

    public function markUnread(MailMessage $message, MailBodyLoader $loader): RedirectResponse
    {
        if (! $loader->markUnread($message)) {
            Inertia::flash('toast', ['type' => 'info', 'message' => 'Chưa cập nhật được trạng thái trên máy chủ, sẽ thử lại ở lần đồng bộ sau.']);
        }

        return $this->destination(null);
    }

    public function reply(SendMailRequest $request, MailMessage $message, MailSender $sender): RedirectResponse
    {
        /** @var Admin $admin */
        $admin = $request->user();

        return $this->afterSend($sender->reply($message, $request->replyInput(), $admin), $message);
    }

    /** Manual "Gửi lại"/"Thử lại" for an `unknown` or `failed` attempt; the UI asks for confirmation first. */
    public function resend(MailOutbox $outbox, MailSender $sender): RedirectResponse
    {
        $message = $outbox->reply_to_message_id !== null ? MailMessage::query()->find($outbox->reply_to_message_id) : null;
        $result = $sender->resend($outbox);

        if ($result === null) {
            Inertia::flash('toast', ['type' => 'info', 'message' => 'Thư này đang được gửi hoặc đã gửi xong.']);

            return $this->destination($message);
        }

        return $this->afterSend($result, $message);
    }

    private function afterSend(MailOutbox $outbox, ?MailMessage $message): RedirectResponse
    {
        Inertia::flash('toast', match ($outbox->status) {
            MailOutbox::STATUS_SENT => ['type' => 'success', 'message' => 'Đã gửi thư.'],
            MailOutbox::STATUS_FAILED => ['type' => 'error', 'message' => 'Chưa gửi được thư: '.$outbox->error],
            MailOutbox::STATUS_UNKNOWN => ['type' => 'info', 'message' => 'Chưa chắc chắn thư đã gửi. Kiểm tra hộp thư Đã gửi trước khi gửi lại.'],
            default => ['type' => 'info', 'message' => 'Thư này đang được gửi.'],
        });

        return $this->destination($message);
    }

    /** * Where a mail action lands: the unified inbox when it was started there (`from_inbox`), the mail screens otherwise. */
    private function destination(?MailMessage $message): RedirectResponse
    {
        if (request()->boolean('from_inbox')) {
            return to_route('inbox.index', $message !== null ? ['m' => $message->id] : []);
        }

        return $message !== null ? to_route('mail.show', ['message' => $message]) : to_route('mail.index');
    }

    /**
     * @param  LengthAwarePaginator<int, MailMessage>  $paginator
     * @return array<string, mixed>
     */
    private function presentPage(LengthAwarePaginator $paginator, string $tab): array
    {
        return $paginator->through(function (MailMessage $message) use ($tab): array {
            // * Inbox shows who wrote; Sent shows who it went to.
            $party = $tab === MailFolder::ROLE_SENT
                ? ($message->to[0] ?? ['name' => null, 'email' => ''])
                : ['name' => $message->from_name, 'email' => $message->from_email ?? ''];

            return [
                'id' => $message->id,
                'mailbox_email' => $message->mailbox->email,
                'party_name' => $party['name'],
                'party_email' => $party['email'],
                'subject' => $message->subject,
                'snippet' => $message->snippet,
                'received_at' => $message->received_at?->toIso8601String(),
                'seen' => $message->seen,
                'has_attachments' => $message->has_attachments,
            ];
        })->toArray();
    }
}
