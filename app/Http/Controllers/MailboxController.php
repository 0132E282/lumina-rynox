<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\SaveMailboxRequest;
use App\Jobs\SyncMailboxJob;
use App\Models\Integration;
use App\Models\Mailbox;
use App\Services\Mail\MailConnectionTester;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * * Mailbox management (`/mail/accounts`). Routes carry `integrations.{view,update}` middleware (see routes/web.php).
 * ! The password never leaves the server: pages get `has_password` and, on the edit form only, `Integration::mask`.
 * ! Deleting a mailbox only removes the app's cached copy; nothing is deleted on the mail server (BR-001).
 */
class MailboxController extends Controller
{
    public function index(): Response
    {
        $legacy = Integration::query()->where('provider', 'email')->first();

        return Inertia::render('mail/accounts/index', [
            'mailboxes' => Mailbox::query()->orderBy('email')->get()->map(fn (Mailbox $mailbox): array => $this->present($mailbox))->all(),
            // * Config saved before this module existed (the old "Email" form): not migrated, only reported so it can be removed.
            'legacy_config' => $legacy !== null && ! empty($legacy->credentials),
        ]);
    }

    public function create(): Response
    {
        return Inertia::render('mail/accounts/form', ['mailbox' => null, ...$this->formProps()]);
    }

    public function store(SaveMailboxRequest $request): RedirectResponse
    {
        $mailbox = Mailbox::query()->create([...$request->mailboxAttributes(), 'status' => Mailbox::STATUS_CONNECTED]);

        SyncMailboxJob::dispatchAfterResponse($mailbox->id);

        return $this->backToList('success', 'Đã lưu hộp thư, đang đồng bộ thư.');
    }

    public function edit(Mailbox $mailbox): Response
    {
        return Inertia::render('mail/accounts/form', [
            'mailbox' => [
                ...$this->present($mailbox),
                'password_mask' => $mailbox->hasPassword() ? Integration::mask($mailbox->password()) : null,
            ],
            ...$this->formProps(),
        ]);
    }

    public function update(SaveMailboxRequest $request, Mailbox $mailbox): RedirectResponse
    {
        $mailbox->fill($request->mailboxAttributes());
        // * Saving the details again clears a recorded failure (BR-007), so a corrected password is tried at once.
        $mailbox->markForRetry();

        SyncMailboxJob::dispatchAfterResponse($mailbox->id);

        return $this->backToList('success', 'Đã lưu hộp thư, đang đồng bộ thư.');
    }

    public function destroy(Mailbox $mailbox): RedirectResponse
    {
        $mailbox->delete();

        return $this->backToList('success', 'Đã xoá hộp thư. Thư trên máy chủ không bị xoá.');
    }

    /** "Kiểm tra kết nối" on the form data (a blank password on edit uses the stored one). Fixed sentences only. */
    public function test(SaveMailboxRequest $request, MailConnectionTester $tester): JsonResponse
    {
        [$imap, $smtp] = $request->connections();
        $result = $tester->test($imap, $smtp);

        return response()->json(['ok' => $result->passed(), 'imap_error' => $result->imapError, 'smtp_error' => $result->smtpError]);
    }

    /** "Đồng bộ ngay" / "Thử lại": clears a recorded failure, then syncs after the response. */
    public function sync(Mailbox $mailbox): RedirectResponse
    {
        $mailbox->markForRetry();

        SyncMailboxJob::dispatchAfterResponse($mailbox->id);

        return $this->backToList('info', 'Đang đồng bộ thư.');
    }

    /** @return array<string, mixed> */
    private function formProps(): array
    {
        return [
            'presets' => collect((array) config('mailbox.presets'))->map(fn (array $preset, string $key): array => ['key' => $key, ...$preset])->values()->all(),
            'sync_intervals' => Mailbox::SYNC_INTERVALS,
        ];
    }

    /** @return array<string, mixed> */
    private function present(Mailbox $mailbox): array
    {
        return [
            'id' => $mailbox->id,
            'email' => $mailbox->email,
            'provider_preset' => $mailbox->provider_preset,
            'imap' => "{$mailbox->imap_host}:{$mailbox->imap_port}",
            'smtp' => "{$mailbox->smtp_host}:{$mailbox->smtp_port}",
            'sync_interval_minutes' => $mailbox->sync_interval_minutes,
            'save_sent_copy' => $mailbox->save_sent_copy,
            'has_password' => $mailbox->hasPassword(),
            'status' => $mailbox->status,
            'status_label' => Mailbox::STATUS_LABELS[$mailbox->status] ?? $mailbox->status,
            'last_error' => $mailbox->last_error,
            'last_synced_at' => $mailbox->last_synced_at?->toIso8601String(),
        ];
    }

    private function backToList(string $type, string $message): RedirectResponse
    {
        Inertia::flash('toast', ['type' => $type, 'message' => $message]);

        return to_route('mail.accounts.index');
    }
}
