<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Admin;
use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Services\Ai\AiAssistant;
use App\Services\Ai\AiException;
use App\Services\Chat\ChatChannels;
use App\Services\Chat\ChatThreadPresenter;
use App\Services\Chat\Matrix\MatrixClient;
use App\Services\Chat\Matrix\MatrixException;
use App\Services\Chat\Telegram\ChatUnavailableException;
use App\Services\Chat\Telegram\TelegramChannel;
use App\Support\ResourcePermission;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * * Multi-channel chat page (Telegram and Zalo). Reading needs `conversations.view`, replying `conversations.reply`
 * * (route middleware). Staff can only answer conversations that already exist; nothing here sends on its own.
 */
class ChatController extends Controller
{
    private const CONVERSATION_LIMIT = 100;

    // * Only paths the inbox generates (`chat/{conversation}/{uuid}.{ext}`) are ever read back from disk.
    private const ATTACHMENT_PATH_PATTERN = '#^chat/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|gif|webp|jpeg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|webm|weba|ogg|oga|m4a|mp3|wav|aac)$#D';

    // * The folder is the conversation id: a UUID now, or the old integer id for pictures saved before the switch to UUID keys.
    private const AVATAR_PATH_PATTERN = '#^chat/avatars/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|gif|webp)$#D';

    private const ATTACHMENT_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    // * Files staff may send (10 MB). Anything outside the list is refused; non-images are only ever served as downloads.
    private const SEND_EXTENSIONS = 'jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,webm,weba,ogg,oga,m4a,mp3,wav,aac';

    public function __construct(
        private readonly ChatChannels $channels,
        private readonly ChatThreadPresenter $threads,
        private readonly MatrixClient $matrix,
    ) {}

    public function index(Request $request): Response
    {
        $validated = $request->validate([
            'c' => ['nullable', 'uuid'],
            'filter' => ['nullable', 'in:all,unread'],
            'q' => ['nullable', 'string', 'max:100'],
        ]);
        $filter = $validated['filter'] ?? 'all';
        $search = trim((string) ($validated['q'] ?? ''));

        $active = isset($validated['c']) ? Conversation::query()->whereKey($validated['c'])->first() : null;

        if ($active !== null) {
            $this->threads->markRead($active);
        }

        $channels = $this->channels->presentAll();

        return Inertia::render('chat/index', [
            'conversations' => $this->conversations($filter, $search),
            'activeConversation' => $active === null ? null : $this->threads->presentConversation($active),
            'messages' => $active === null ? ['data' => [], 'has_more' => false] : $this->threads->messagePage($active, null),
            'filters' => ['filter' => $filter, 'q' => $search],
            // * The channel of the open conversation; Telegram until one is open.
            'channel' => $channels[$active->provider ?? TelegramChannel::PROVIDER] ?? $channels[TelegramChannel::PROVIDER],
            'channels' => $channels,
            'unreadTotal' => (int) Conversation::query()->sum('unread_count'),
            'canReply' => ResourcePermission::allows($request->user(), 'conversations', 'reply'),
            'canReconnect' => ResourcePermission::allows($request->user(), 'integrations', 'update'),
        ]);
    }

    /** * Older messages for "load earlier": the page before `before` (a message id). */
    public function messages(Request $request, Conversation $conversation): JsonResponse
    {
        $validated = $request->validate(['before' => ['required', 'integer', 'min:1']]);

        return response()->json($this->threads->messagePage($conversation, (int) $validated['before']));
    }

    public function send(Request $request, Conversation $conversation): RedirectResponse
    {
        $validated = $request->validate([
            'body' => ['required', 'string', 'max:'.ChatMessage::MAX_BODY_LENGTH],
            'client_token' => ['required', 'string', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
        ]);
        $user = $request->user();

        try {
            $this->channels->sender($conversation->provider)->send(
                $conversation,
                $validated['body'],
                $validated['client_token'],
                $user instanceof Admin ? $user->name : null,
            );
        } catch (ChatUnavailableException $exception) {
            return back()->withErrors(['body' => $exception->getMessage()]);
        }

        return back();
    }

    /** * Sends one file with an optional caption (route middleware: `conversations.reply`). */
    public function sendAttachment(Request $request, Conversation $conversation): RedirectResponse|JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:10240', 'mimes:'.self::SEND_EXTENSIONS],
            'body' => ['nullable', 'string', 'max:'.ChatMessage::MAX_BODY_LENGTH],
            'client_token' => ['required', 'string', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
        ]);
        $user = $request->user();

        try {
            $this->channels->sender($conversation->provider)->sendAttachment(
                $conversation,
                $validated['file'],
                trim((string) ($validated['body'] ?? '')),
                $validated['client_token'],
                $user instanceof Admin ? $user->name : null,
            );
        } catch (ChatUnavailableException $exception) {
            return $request->expectsJson()
                ? response()->json(['message' => $exception->getMessage()], 422)
                : back()->withErrors(['body' => $exception->getMessage()]);
        }

        return $request->expectsJson() ? response()->json(['ok' => true]) : back();
    }

    /** * Global pin (route middleware: `conversations.reply`): a pinned conversation stays first in every list. */
    public function pin(Request $request, Conversation $conversation): RedirectResponse
    {
        $validated = $request->validate(['pinned' => ['required', 'boolean']]);

        $conversation->forceFill(['pinned_at' => $validated['pinned'] ? now() : null])->save();

        return back();
    }

    /** * AI draft for the composer (route middleware: `conversations.reply`). Returned as JSON only: no `ChatMessage` is created and nothing is sent. */
    public function suggest(Conversation $conversation, AiAssistant $assistant): JsonResponse
    {
        try {
            return response()->json(['draft' => $assistant->suggestReply($conversation)]);
        } catch (AiException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    /** * Manual "Gửi lại"/"Thử lại" for a `unknown` or `failed` message; the UI asks for confirmation first. */
    public function resend(ChatMessage $message): RedirectResponse
    {
        try {
            if ($this->channels->sender($message->conversation->provider)->resend($message) === null) {
                Inertia::flash('toast', ['type' => 'info', 'message' => 'Tin nhắn này đang được gửi hoặc đã gửi xong.']);
            }
        } catch (ChatUnavailableException $exception) {
            Inertia::flash('toast', ['type' => 'error', 'message' => $exception->getMessage()]);
        }

        return back();
    }

    /** * Streams the stored image of an inbound message; same permission as reading the conversation (route middleware). */
    public function attachment(Request $request, ChatMessage $message): StreamedResponse
    {
        if ($message->attachment_mxc !== null) {
            return $this->relayAudio($request, $message);
        }

        $path = $message->attachment_path;
        $mime = $message->attachment_mime;
        $disk = Storage::disk(ChatMessage::ATTACHMENT_DISK);

        if ($path === null || $mime === null || preg_match(self::ATTACHMENT_PATH_PATTERN, $path) !== 1 || ! $disk->exists($path)) {
            abort(404);
        }

        // * A voice recording is played inline under its whitelisted audio type; every other non-picture is a download.
        if (in_array($mime, MatrixClient::AUDIO_MIMES, true)) {
            return $disk->response($path, null, [
                'Content-Type' => $mime,
                'X-Content-Type-Options' => 'nosniff',
                'Cache-Control' => 'private, max-age=86400',
                'Content-Security-Policy' => "default-src 'none'; sandbox",
            ], 'inline');
        }

        // * A file that is not a picture is never rendered by the browser: it downloads under a neutral type.
        if (! in_array($mime, self::ATTACHMENT_MIMES, true)) {
            return $disk->download($path, $message->attachment_name ?? basename($path), ['X-Content-Type-Options' => 'nosniff', 'Content-Type' => 'application/octet-stream']);
        }

        return $disk->response($path, null, [
            'Content-Type' => $mime,
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=86400',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], 'inline');
    }

    /** * Voice message or video: nothing is stored, the homeserver's media is relayed (with `Range`) under a whitelisted type. */
    private function relayAudio(Request $request, ChatMessage $message): StreamedResponse
    {
        $mime = $message->attachment_mime;

        if (! in_array($mime, [...MatrixClient::AUDIO_MIMES, ...MatrixClient::VIDEO_MIMES], true)) {
            abort(404);
        }

        try {
            $upstream = $this->matrix->streamMedia((string) $message->attachment_mxc, $request->header('Range'));
        } catch (MatrixException|ConnectionException) {
            abort(502);
        }

        $headers = array_filter([
            'Content-Type' => $mime,
            'Content-Length' => $upstream->header('Content-Length') ?: null,
            'Content-Range' => $upstream->header('Content-Range') ?: null,
            'Accept-Ranges' => 'bytes',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=86400',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ]);

        return response()->stream(function () use ($upstream): void {
            $body = $upstream->toPsrResponse()->getBody();

            while (! $body->eof()) {
                echo $body->read(8192);
                flush();
            }
        }, $upstream->status() === 206 ? 206 : 200, $headers);
    }

    /** * Streams the stored profile picture of a conversation; same permission and headers as `attachment`. */
    public function avatar(Conversation $conversation): StreamedResponse
    {
        $path = $conversation->avatar_path;
        $disk = Storage::disk(ChatMessage::ATTACHMENT_DISK);

        if ($path === null || preg_match(self::AVATAR_PATH_PATTERN, $path) !== 1 || ! $disk->exists($path)) {
            abort(404);
        }

        // * The extension is server-generated, so it maps back to the whitelisted mime.
        $mime = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'][pathinfo($path, PATHINFO_EXTENSION)];

        return $disk->response($path, null, [
            'Content-Type' => $mime,
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=86400',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], 'inline');
    }

    /** @return array<int, array<string, mixed>> */
    private function conversations(string $filter, string $search): array
    {
        return Conversation::query()
            ->when($filter === 'unread', fn ($query) => $query->where('unread_count', '>', 0))
            ->when($search !== '', function ($query) use ($search) {
                $like = '%'.addcslashes($search, '\\%_').'%';

                $query->where(fn ($inner) => $inner->where('title', 'like', $like)->orWhere('username', 'like', $like));
            })
            // * Pinned conversations first, then by activity. Contacts synced without a message (null `last_message_at`) go after the active ones on every database (Postgres puts NULL first on DESC).
            ->orderByRaw('pinned_at is null')
            ->orderByRaw('last_message_at is null')
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->limit(self::CONVERSATION_LIMIT)
            ->with($this->channels->conversationRelations())
            ->get()
            ->map(fn (Conversation $conversation): array => $this->threads->presentConversation($conversation))
            ->values()
            ->all();
    }
}
