<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Conversation;
use App\Models\MailFolder;
use App\Models\MailMessage;
use App\Services\Chat\ChatChannels;
use App\Services\Chat\ChatThreadPresenter;
use App\Services\Chat\Telegram\TelegramChannel;
use App\Services\Mail\MailThreadPresenter;
use App\Support\ResourcePermission;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

/**
 * * Unified inbox (`/inbox`): conversations of every chat channel and INBOX mail in one time-sorted list with a channel filter.
 * * Only the list lives here. Opening a thread reuses `ChatThreadPresenter` / `MailThreadPresenter`, and replying still goes through
 * * `ChatController::send` (`conversations.reply`) and `MailController::reply` (`mail.send`). A channel the user may not read is left out of the list.
 */
class InboxController extends Controller
{
    private const PER_PAGE = 30;

    private const CHANNEL_ALL = 'all';

    private const CHANNEL_EMAIL = 'email';

    // * Tab order; a provider registered later and not listed here goes after these.
    private const CHANNEL_ORDER = [self::CHANNEL_EMAIL, 'zalo', 'messenger', TelegramChannel::PROVIDER];

    // * Messenger personal chats are Facebook accounts, so the tab carries the Facebook name.
    private const CHANNEL_LABELS = [
        self::CHANNEL_EMAIL => 'Email',
        'messenger' => 'Facebook',
    ];

    public function __construct(
        private readonly ChatChannels $channels,
        private readonly ChatThreadPresenter $chatThreads,
        private readonly MailThreadPresenter $mailThreads,
    ) {}

    public function index(Request $request): Response
    {
        $user = $request->user();
        $canChat = ResourcePermission::allows($user, 'conversations', 'view');
        $canMail = ResourcePermission::allows($user, 'mail', 'view');

        // * Neither channel is readable: same answer as the route middleware of `/chat` and `/mail`.
        abort_unless($canChat || $canMail, 403);

        $channelKeys = array_column($this->channelOptions($canChat, $canMail), 'key');
        $validated = $request->validate([
            'channel' => ['nullable', 'in:'.implode(',', [self::CHANNEL_ALL, ...$channelKeys])],
            'filter' => ['nullable', 'in:all,unread'],
            'q' => ['nullable', 'string', 'max:100'],
            'c' => ['nullable', 'uuid'],
            'm' => ['nullable', 'integer'],
        ]);
        $channel = $validated['channel'] ?? self::CHANNEL_ALL;
        $filter = $validated['filter'] ?? 'all';
        $search = trim((string) ($validated['q'] ?? ''));

        $activeConversation = $canChat && isset($validated['c']) ? Conversation::query()->whereKey($validated['c'])->first() : null;
        $activeMail = $canMail && $activeConversation === null && isset($validated['m']) ? MailMessage::query()->whereKey($validated['m'])->first() : null;

        if ($activeConversation !== null) {
            $this->chatThreads->markRead($activeConversation);
        }

        $chatChannels = $canChat ? $this->channels->presentAll() : [];

        return Inertia::render('inbox/index', [
            // * Props resolve in this order on a full visit: the mail thread is opened (marks the message read) before the list is read, so the row shows as read.
            // * A live reload that leaves `mailThread` out never opens the message again (no IMAP call every few seconds).
            'mailThread' => fn () => $activeMail === null ? null : $this->mailThreads->props($request, $activeMail),
            'items' => fn () => $this->items($canChat, $canMail, $channel, $filter, $search, $chatChannels),
            'activeConversation' => fn () => $activeConversation === null ? null : $this->chatThreads->presentConversation($activeConversation),
            'messages' => fn () => $activeConversation === null ? ['data' => [], 'has_more' => false] : $this->chatThreads->messagePage($activeConversation, null),
            'channel' => fn () => $activeConversation === null ? null : ($chatChannels[$activeConversation->provider] ?? null),
            'channels' => $chatChannels,
            'channelTabs' => $this->channelOptions($canChat, $canMail),
            'filters' => ['channel' => $channel, 'filter' => $filter, 'q' => $search],
            'activeMailId' => $activeMail?->id,
            'can' => [
                'chat' => $canChat,
                'mail' => $canMail,
                'reply' => ResourcePermission::allows($user, 'conversations', 'reply'),
                'reconnect' => ResourcePermission::allows($user, 'integrations', 'update'),
                'manage_mailboxes' => ResourcePermission::allows($user, 'integrations', 'view'),
            ],
        ]);
    }

    /**
     * Channel tabs without "Tất cả": the providers the chat module has registered (plus the Zalo group split) and Email, limited to what the user may read.
     *
     * Each tab carries its unread count: the sum of `unread_count` over that provider's conversations, or the unseen INBOX mail for Email.
     *
     * @return list<array{key: string, label: string, unread: int}>
     */
    private function channelOptions(bool $canChat, bool $canMail): array
    {
        $keys = [];

        if ($canMail) {
            $keys[] = self::CHANNEL_EMAIL;
        }

        if ($canChat) {
            foreach ($this->channels->providers() as $provider) {
                $keys[] = $provider;
            }
        }

        usort($keys, function (string $left, string $right): int {
            $leftRank = array_search($left, self::CHANNEL_ORDER, true);
            $rightRank = array_search($right, self::CHANNEL_ORDER, true);

            return ($leftRank === false ? PHP_INT_MAX : $leftRank) <=> ($rightRank === false ? PHP_INT_MAX : $rightRank);
        });

        // * Two grouped aggregates, however many tabs there are.
        $chatUnread = $canChat ? DB::table('conversations')->where('unread_count', '>', 0)->groupBy('provider')->selectRaw('provider, sum(unread_count) as total')->pluck('total', 'provider') : collect();
        $mailUnread = $canMail ? $this->mailQuery(true, '')->count() : 0;

        return array_map(fn (string $key): array => [
            'key' => $key,
            'label' => self::CHANNEL_LABELS[$key] ?? ucfirst($key),
            'unread' => $key === self::CHANNEL_EMAIL ? $mailUnread : (int) ($chatUnread[$key] ?? 0),
        ], $keys);
    }

    /**
     * One page of the merged list. Two indexed selects are UNIONed and ordered/paginated by the database; the page rows are then loaded with
     * one query per table (conversations with their channel relations, mail with its mailbox), so the cost does not grow with the page size.
     *
     * @param  array<string, array<string, mixed>>  $chatChannels
     * @return array<string, mixed>
     */
    private function items(bool $canChat, bool $canMail, string $channel, string $filter, string $search, array $chatChannels): array
    {
        $includeChat = $canChat && $channel !== self::CHANNEL_EMAIL;
        $includeMail = $canMail && in_array($channel, [self::CHANNEL_ALL, self::CHANNEL_EMAIL], true);
        $unread = $filter === 'unread';
        $sources = [];

        if ($includeChat) {
            $sources[] = $this->chatQuery($channel, $unread, $search);
        }

        if ($includeMail) {
            $sources[] = $this->mailQuery($unread, $search);
        }

        $union = array_shift($sources);

        foreach ($sources as $source) {
            $union->unionAll($source);
        }

        $page = DB::query()
            ->fromSub($union, 'inbox_items')
            // * Pinned conversations first (mail is never pinned), then by activity. Contacts synced without a message (null `sort_at`) go after the active ones on every database (Postgres puts NULL first on DESC).
            ->orderByRaw('pinned_at is null')
            ->orderByRaw('sort_at is null')
            ->orderByDesc('sort_at')
            // * `id` mixes UUIDs and mail ids as text, so it only makes the order stable; `kind` goes first to keep the two id spaces apart.
            ->orderBy('kind')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        return $this->present($page, $chatChannels);
    }

    private function chatQuery(string $channel, bool $unread, string $search): Builder
    {
        return DB::table('conversations')
            ->selectRaw($this->usesCharCast() ? "'chat' as kind, cast(id as char(36)) as id, last_message_at as sort_at, pinned_at" : "'chat' as kind, cast(id as text) as id, last_message_at as sort_at, pinned_at")
            ->when($channel !== self::CHANNEL_ALL, fn (Builder $query) => $query->where('provider', $channel))
            ->when($unread, fn (Builder $query) => $query->where('unread_count', '>', 0))
            ->when($search !== '', function (Builder $query) use ($search) {
                $like = $this->likePattern($search);

                $query->where(fn (Builder $inner) => $inner
                    ->whereRaw("title like ? escape '!'", [$like])
                    ->orWhereRaw("username like ? escape '!'", [$like]));
            });
    }

    /** * Chat ids are UUIDs and mail ids integers: both go through the UNION as text. MySQL has no `text` cast target, so it uses `char`. */
    private function usesCharCast(): bool
    {
        return in_array(DB::connection()->getDriverName(), ['mysql', 'mariadb'], true);
    }

    /** * `!` is the escape character, declared in the SQL: `\` is not an escape in every database, so `%` and `_` are plain characters everywhere. */
    private function likePattern(string $search): string
    {
        return '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%';
    }

    private function mailQuery(bool $unread, string $search): Builder
    {
        return DB::table('mail_messages')
            ->selectRaw($this->usesCharCast() ? "'mail' as kind, cast(id as char(36)) as id, received_at as sort_at, null as pinned_at" : "'mail' as kind, cast(id as text) as id, received_at as sort_at, null as pinned_at")
            ->whereIn('mail_folder_id', MailFolder::query()->where('role', MailFolder::ROLE_INBOX)->select('id'))
            ->when($unread, fn (Builder $query) => $query->where('seen', false))
            ->when($search !== '', function (Builder $query) use ($search) {
                $like = $this->likePattern($search);

                $query->where(fn (Builder $inner) => $inner
                    ->whereRaw("subject like ? escape '!'", [$like])
                    ->orWhereRaw("from_name like ? escape '!'", [$like])
                    ->orWhereRaw("from_email like ? escape '!'", [$like])
                    ->orWhereRaw("snippet like ? escape '!'", [$like]));
            });
    }

    /**
     * @param  LengthAwarePaginator<int, object>  $page
     * @param  array<string, array<string, mixed>>  $chatChannels
     * @return array<string, mixed>
     */
    private function present(LengthAwarePaginator $page, array $chatChannels): array
    {
        /** @var Collection<int, object{kind: string, id: string}> $rows */
        $rows = $page->getCollection();
        $chatIds = $rows->where('kind', 'chat')->pluck('id')->map(fn (mixed $id): string => (string) $id)->all();
        $mailIds = $rows->where('kind', 'mail')->pluck('id')->map(fn (mixed $id): int => (int) $id)->all();

        $conversations = $chatIds === [] ? collect() : Conversation::query()
            ->whereIn('id', $chatIds)
            ->with($this->channels->conversationRelations())
            ->get()
            ->keyBy('id');
        $mails = $mailIds === [] ? collect() : MailMessage::query()
            ->select(['id', 'mailbox_id', 'from_name', 'from_email', 'subject', 'snippet', 'received_at', 'seen', 'has_attachments'])
            ->with('mailbox:id,email')
            ->whereIn('id', $mailIds)
            ->get()
            ->keyBy('id');

        $data = [];

        foreach ($rows as $row) {
            $item = $row->kind === 'chat'
                ? $this->presentChat($conversations->get((string) $row->id), $chatChannels)
                : $this->presentMail($mails->get((int) $row->id));

            if ($item !== null) {
                $data[] = $item;
            }
        }

        return [
            'data' => $data,
            'current_page' => $page->currentPage(),
            'last_page' => $page->lastPage(),
            'total' => $page->total(),
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $chatChannels
     * @return array<string, mixed>|null
     */
    private function presentChat(?Conversation $conversation, array $chatChannels): ?array
    {
        if ($conversation === null) {
            return null;
        }

        return [
            ...$this->chatThreads->presentConversation($conversation),
            'kind' => 'chat',
            'key' => "chat:{$conversation->id}",
            'channel' => $conversation->provider,
            'connected' => (bool) ($chatChannels[$conversation->provider]['connected'] ?? false),
            'account_count' => (int) ($chatChannels[$conversation->provider]['account_count'] ?? 0),
        ];
    }

    /** @return array<string, mixed>|null */
    private function presentMail(?MailMessage $message): ?array
    {
        if ($message === null) {
            return null;
        }

        return [
            'kind' => 'mail',
            'key' => "mail:{$message->id}",
            'channel' => self::CHANNEL_EMAIL,
            'id' => $message->id,
            // * Shaped like a conversation so the list renders both the same way.
            'provider' => self::CHANNEL_EMAIL,
            'type' => 'private',
            'title' => $message->from_name ?: ($message->from_email ?? '(Không rõ người gửi)'),
            'username' => null,
            'last_message_preview' => $message->subject ?: $message->snippet,
            'last_message_direction' => 'in',
            'last_message_at' => $message->received_at?->toIso8601String(),
            'unread_count' => $message->seen ? 0 : 1,
            'avatar_url' => null,
            'pinned' => false,
            'account' => ['id' => $message->mailbox_id, 'name' => $message->mailbox->email, 'avatar_url' => null],
            'connected' => true,
            'account_count' => 0,
        ];
    }
}
