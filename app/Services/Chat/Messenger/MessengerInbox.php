<?php

declare(strict_types=1);

namespace App\Services\Chat\Messenger;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\Matrix\MatrixClient;
use App\Services\Chat\Matrix\MatrixException;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Turns one `/sync` response into `Conversation` + `ChatMessage` rows for Messenger portal rooms. Management rooms
 * (bot + app only) and group rooms (BR-006) are skipped entirely. Room classification relies on membership state
 * read from the batch itself (A8 in docs/design/messenger-personal-mautrix.md): UNVERIFIED against a real bridge.
 *
 * @phpstan-type MatrixEvent array<string, mixed>
 */
final class MessengerInbox
{
    private const PREVIEW_LENGTH = 120;

    public const ATTACHMENT_DISK = ChatMessage::ATTACHMENT_DISK;

    public const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

    public const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

    // * Server-chosen extension per whitelisted mime; the sender's file name is never used.
    private const IMAGE_EXTENSIONS = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
    ];

    // * Voice messages are not stored: the browser plays them through `ChatController::attachment`, which relays the media.
    private const AUDIO_ALIASES = [
        'video/mp4' => 'audio/mp4',
        'audio/x-m4a' => 'audio/mp4',
        'video/webm' => 'audio/webm',
        'video/ogg' => 'audio/ogg',
        'application/ogg' => 'audio/ogg',
        'audio/x-wav' => 'audio/wav',
        'audio/x-aac' => 'audio/aac',
    ];

    private const AUDIO_PREVIEW = 'Đã gửi một tin nhắn thoại';

    private const AUDIO_FAILED_BODY = '[Tin nhắn thoại]';

    private const VIDEO_PREVIEW = 'Đã gửi một video';

    private const VIDEO_FAILED_BODY = '[Video]';

    private const IMAGE_ONLY_PREVIEW = 'Đã gửi một ảnh';

    private const IMAGE_FAILED_BODY = '[Ảnh]';

    private const UNSUPPORTED_LABELS = [
        'm.file' => 'tệp',
    ];

    private const STATUS_RELATION_KEY = 'm.relates_to';

    private const FAILED_SEND_STATUSES = ['FAIL_RETRIABLE', 'FAIL_PERMANENT'];

    /**
     * Ghost user id => account, for every account of the channel (any status): a message from any of these ghosts is the
     * owner's own echo from another device. Rebuilt at the start of each `ingest()`.
     *
     * @var array<string, MessengerAccount>
     */
    private array $selfGhosts = [];

    public function __construct(private readonly MessengerChannel $channel, private readonly MatrixClient $matrix) {}

    /**
     * @param  array<string, mixed>  $sync  the raw `/sync` response
     * @return array{conversations: int, stored: int, failedStatuses: int}
     */
    public function ingest(Integration $integration, array $sync): array
    {
        $rooms = is_array($sync['rooms']['join'] ?? null) ? $sync['rooms']['join'] : [];
        $accounts = $this->channel->accounts($integration);
        $this->selfGhosts = $this->indexSelfGhosts($accounts);
        $knownRoomIds = Conversation::query()
            ->where('provider', MessengerChannel::PROVIDER)
            ->whereIn('external_chat_id', array_filter(array_keys($rooms), 'is_string'))
            ->pluck('external_chat_id')
            ->flip();
        $conversations = 0;
        $stored = 0;
        $failedStatuses = 0;

        foreach ($rooms as $roomId => $room) {
            if (! is_string($roomId) || $roomId === '' || ! is_array($room)) {
                continue;
            }

            $stateEvents = $this->events($room, 'state');
            $timelineEvents = $this->events($room, 'timeline');
            // * An incremental batch rarely repeats the full member list: a room already known as a portal stays one
            // * even when this batch carries no membership state at all.
            $classification = $knownRoomIds->has($roomId)
                ? ['type' => 'portal', 'otherUserId' => null, 'account' => $this->accountInRoom($stateEvents, $timelineEvents)]
                : $this->classify($stateEvents, $timelineEvents);

            if ($classification['type'] !== 'portal') {
                continue;
            }

            $conversation = $this->upsertConversation(
                $integration,
                $roomId,
                $this->title($stateEvents, $timelineEvents, $classification['otherUserId']),
                $classification['account'] ?? ($accounts->count() === 1 ? $accounts->first() : null),
            );
            $conversations++;
            $this->syncAccountAvatar($classification['account'], [...$stateEvents, ...$timelineEvents]);
            // * A short room puts its member/avatar state events inside the timeline, so both lists are read (as `classify` does).
            $this->syncAvatar($conversation, [...$stateEvents, ...$timelineEvents]);

            // * `receive` is a scope of the conversation's own account (an account without stored scopes keeps the default: on).
            $account = $conversation->messengerAccount;
            $receiveAllowed = $account === null || $account->allows('receive');

            foreach ($timelineEvents as $event) {
                if ($this->isStatusEvent($event)) {
                    if ($this->applyStatusEvent($conversation, $event)) {
                        $failedStatuses++;
                    }

                    continue;
                }

                if ($receiveAllowed && $this->accepts($event)) {
                    if ($this->storeMessage($integration, $conversation, $event, $stateEvents, $timelineEvents)) {
                        $stored++;
                    }
                }
            }
        }

        return ['conversations' => $conversations, 'stored' => $stored, 'failedStatuses' => $failedStatuses];
    }

    /**
     * @param  array<string, mixed>  $room
     * @return list<MatrixEvent>
     */
    private function events(array $room, string $section): array
    {
        $events = $room[$section]['events'] ?? null;

        return is_array($events) ? array_values(array_filter($events, 'is_array')) : [];
    }

    /**
     * Ghosts of EVERY connected account are "us", never the second person: a room holding two of our own accounts has
     * no correspondent and stays a management/ignored room.
     *
     * @param  list<MatrixEvent>  $stateEvents
     * @param  list<MatrixEvent>  $timelineEvents
     * @return array{type: string, otherUserId: ?string, account: ?MessengerAccount}
     */
    private function classify(array $stateEvents, array $timelineEvents): array
    {
        $botUserId = (string) config('services.mautrix_meta.bot_user_id');
        $ownUserId = (string) config('services.matrix.user_id');
        $joined = $this->joinedMembers($stateEvents, $timelineEvents);

        $others = array_values(array_filter(
            $joined,
            fn (string $userId): bool => $userId !== $botUserId && $userId !== $ownUserId && ! isset($this->selfGhosts[$userId]),
        ));
        $account = $this->accountInRoom($stateEvents, $timelineEvents);

        return match (true) {
            $others === [] => ['type' => 'managed', 'otherUserId' => null, 'account' => $account],
            count($others) === 1 => ['type' => 'portal', 'otherUserId' => $others[0], 'account' => $account],
            default => ['type' => 'group', 'otherUserId' => null, 'account' => $account],
        };
    }

    /**
     * @param  list<MatrixEvent>  $stateEvents
     * @param  list<MatrixEvent>  $timelineEvents
     * @return list<string> user ids currently joined, as far as this batch shows
     */
    private function joinedMembers(array $stateEvents, array $timelineEvents): array
    {
        $joined = [];

        foreach ([...$stateEvents, ...$timelineEvents] as $event) {
            if (($event['type'] ?? null) !== 'm.room.member' || ! is_string($event['state_key'] ?? null)) {
                continue;
            }

            $userId = $event['state_key'];

            if (($event['content']['membership'] ?? null) === 'join') {
                $joined[$userId] = true;
            } else {
                unset($joined[$userId]);
            }
        }

        return array_map('strval', array_keys($joined));
    }

    /**
     * The account whose own ghost is a joined member of the room (null when the batch shows none).
     *
     * @param  list<MatrixEvent>  $stateEvents
     * @param  list<MatrixEvent>  $timelineEvents
     */
    private function accountInRoom(array $stateEvents, array $timelineEvents): ?MessengerAccount
    {
        foreach ($this->joinedMembers($stateEvents, $timelineEvents) as $userId) {
            if (isset($this->selfGhosts[$userId])) {
                return $this->selfGhosts[$userId];
            }
        }

        return null;
    }

    /**
     * @param  iterable<MessengerAccount>  $accounts
     * @return array<string, MessengerAccount>
     */
    private function indexSelfGhosts(iterable $accounts): array
    {
        $ownUserId = (string) config('services.matrix.user_id');
        $prefix = (string) config('services.mautrix_meta.ghost_prefix', '@meta_');
        $colon = strpos($ownUserId, ':');
        $ghosts = [];

        if ($colon === false) {
            return $ghosts;
        }

        foreach ($accounts as $account) {
            $ghosts[$prefix.$account->ghostRemoteId().substr($ownUserId, $colon)] = $account;
        }

        return $ghosts;
    }

    /**
     * @param  list<MatrixEvent>  $stateEvents
     * @param  list<MatrixEvent>  $timelineEvents
     */
    private function title(array $stateEvents, array $timelineEvents, ?string $otherUserId): ?string
    {
        foreach ([...$stateEvents, ...$timelineEvents] as $event) {
            if (($event['type'] ?? null) === 'm.room.name') {
                $name = $event['content']['name'] ?? null;

                if (is_string($name) && trim($name) !== '') {
                    return trim($name);
                }
            }
        }

        if ($otherUserId === null) {
            return null;
        }

        return $this->displayName($stateEvents, $timelineEvents, $otherUserId);
    }

    /**
     * @param  list<MatrixEvent>  $stateEvents
     * @param  list<MatrixEvent>  $timelineEvents
     */
    private function displayName(array $stateEvents, array $timelineEvents, string $userId): ?string
    {
        $name = null;

        foreach ([...$stateEvents, ...$timelineEvents] as $event) {
            if (($event['type'] ?? null) === 'm.room.member' && ($event['state_key'] ?? null) === $userId) {
                $candidate = $event['content']['displayname'] ?? null;

                if (is_string($candidate) && trim($candidate) !== '') {
                    $name = trim($candidate);
                }
            }
        }

        return $name;
    }

    private function upsertConversation(Integration $integration, string $roomId, ?string $title, ?MessengerAccount $account): Conversation
    {
        $fallbackTitle = Str::limit($title ?? ('Messenger '.$roomId), 255, '');

        $conversation = Conversation::query()->createOrFirst(
            ['provider' => MessengerChannel::PROVIDER, 'external_chat_id' => $roomId],
            ['integration_id' => $integration->id, 'messenger_account_id' => $account?->id, 'type' => Conversation::TYPE_PRIVATE, 'title' => $fallbackTitle],
        );

        $dirty = false;

        if ($conversation->integration_id !== $integration->id) {
            $conversation->integration_id = $integration->id;
            $dirty = true;
        }

        // * The account is only ever set or moved when the batch (or the single-account fallback) names one.
        if ($account !== null && $conversation->messenger_account_id !== $account->id) {
            $conversation->messenger_account_id = $account->id;
            $dirty = true;
        }

        // * A real name replaces the placeholder title; a batch without one never overwrites a known title.
        if ($title !== null) {
            $limited = Str::limit($title, 255, '');

            if ($conversation->title !== $limited) {
                $conversation->title = $limited;
                $dirty = true;
            }
        }

        if ($dirty) {
            $conversation->save();
        }

        return $conversation;
    }

    /** @param MatrixEvent $event */
    private function isStatusEvent(array $event): bool
    {
        return ($event['type'] ?? null) === 'com.beeper.message_send_status';
    }

    /** @param MatrixEvent $event */
    private function applyStatusEvent(Conversation $conversation, array $event): bool
    {
        $content = is_array($event['content'] ?? null) ? $event['content'] : [];
        $status = $content['status'] ?? null;
        $relatesTo = $content[self::STATUS_RELATION_KEY]['event_id'] ?? null;

        if (! is_string($status) || ! is_string($relatesTo) || ! in_array($status, self::FAILED_SEND_STATUSES, true)) {
            return false;
        }

        $updated = ChatMessage::query()
            ->where('conversation_id', $conversation->id)
            ->where('direction', ChatMessage::DIRECTION_OUT)
            ->where('external_message_id', $relatesTo)
            ->where('send_status', ChatMessage::STATUS_SENT)
            ->update(['send_status' => ChatMessage::STATUS_FAILED, 'error' => 'Messenger không gửi được tin này.']);

        return $updated > 0;
    }

    /** @param MatrixEvent $event */
    private function accepts(array $event): bool
    {
        $sender = $event['sender'] ?? null;
        $type = $event['type'] ?? null;

        if (! is_string($sender) || ! in_array($type, ['m.room.message', 'm.sticker'], true)) {
            return false;
        }

        $ownUserId = (string) config('services.matrix.user_id');
        $botUserId = (string) config('services.mautrix_meta.bot_user_id');

        // * BR-005: never the app's own message (even its echo), the bridge bot, or the ghost of any connected account (the owner on another device).
        if ($sender === $ownUserId || $sender === $botUserId || isset($this->selfGhosts[$sender])) {
            return false;
        }

        $content = is_array($event['content'] ?? null) ? $event['content'] : [];

        if (($content[self::STATUS_RELATION_KEY]['rel_type'] ?? null) === 'm.replace') {
            return false;
        }

        if ($type === 'm.room.message' && ($content['msgtype'] ?? null) === 'm.notice') {
            return false;
        }

        return true;
    }

    /**
     * History (backfill, or a message sent before the account was connected) is stored but never counts as unread.
     * Without a usable `connected_at` (of the conversation's account) or timestamp the message is treated as new.
     *
     * @param  MatrixEvent  $event
     */
    private function isBeforeConnection(Conversation $conversation, array $event): bool
    {
        $connectedAt = $conversation->messengerAccount?->connected_at;
        $originTs = $event['origin_server_ts'] ?? null;

        if ($connectedAt === null || ! is_int($originTs)) {
            return false;
        }

        return $originTs < $connectedAt->getTimestampMs();
    }

    /**
     * @param  MatrixEvent  $event
     * @param  list<MatrixEvent>  $stateEvents
     * @param  list<MatrixEvent>  $timelineEvents
     */
    private function storeMessage(Integration $integration, Conversation $conversation, array $event, array $stateEvents, array $timelineEvents): bool
    {
        $eventId = $event['event_id'] ?? null;
        $sender = $event['sender'] ?? null;

        if (! is_string($eventId) || $eventId === '' || ! is_string($sender)) {
            return false;
        }

        $historical = $this->isBeforeConnection($conversation, $event);
        $imageUri = $this->imageUri($event);
        $audioUri = $this->audioUri($event);
        $videoUri = $this->videoUri($event);

        // * Skip the download for a message that is already stored (a repeated batch).
        if (($imageUri !== null || $audioUri !== null || $videoUri !== null) && ChatMessage::query()->where('conversation_id', $conversation->id)->where('external_message_id', $eventId)->exists()) {
            return false;
        }

        $attachment = match (true) {
            $imageUri !== null => $this->downloadImage($conversation, $imageUri),
            $audioUri !== null => $this->audioAttachment($event, $audioUri),
            $videoUri !== null => $this->videoAttachment($event, $videoUri),
            default => null,
        };
        $body = match (true) {
            $imageUri !== null => $this->imageBody($event, $attachment !== null),
            $audioUri !== null => $attachment !== null ? '' : self::AUDIO_FAILED_BODY,
            $videoUri !== null => $attachment !== null ? '' : self::VIDEO_FAILED_BODY,
            default => $this->body($event),
        };
        // * An incremental batch carries no member state, so the name falls back to the 1-1 chat title (the customer's own name).
        $senderName = $this->displayName($stateEvents, $timelineEvents, $sender) ?? $conversation->title;
        $originTs = $event['origin_server_ts'] ?? null;
        $sentAt = is_int($originTs) ? CarbonImmutable::createFromTimestampMs($originTs) : CarbonImmutable::now();

        $message = ChatMessage::query()->createOrFirst(
            ['conversation_id' => $conversation->id, 'external_message_id' => $eventId],
            [
                'direction' => ChatMessage::DIRECTION_IN,
                'sender_type' => ChatMessage::SENDER_CUSTOMER,
                'sender_name' => $senderName === null ? null : Str::limit($senderName, 255, ''),
                'body' => $body,
                'sent_at' => $sentAt,
                ...($attachment ?? []),
            ],
        );

        if (! $message->wasRecentlyCreated) {
            // * Lost a race with another batch: the file just written belongs to no row.
            if (isset($attachment['attachment_path'])) {
                Storage::disk(self::ATTACHMENT_DISK)->delete($attachment['attachment_path']);
            }

            return false;
        }

        // * Only a newer message moves the preview, so a late batch cannot roll the list back.
        if ($conversation->last_message_at === null || $sentAt >= $conversation->last_message_at) {
            $conversation->fill([
                'last_message_preview' => match (true) {
                    $audioUri !== null && $attachment !== null => self::AUDIO_PREVIEW,
                    $videoUri !== null && $attachment !== null => self::VIDEO_PREVIEW,
                    default => $this->preview($body, $attachment !== null),
                },
                'last_message_direction' => ChatMessage::DIRECTION_IN,
                'last_message_at' => $sentAt,
            ]);
        }

        if (! $historical) {
            $conversation->unread_count++;
        }

        $conversation->save();

        return true;
    }

    /** @param MatrixEvent $event */
    private function body(array $event): string
    {
        $content = is_array($event['content'] ?? null) ? $event['content'] : [];
        $msgtype = $content['msgtype'] ?? null;

        if (in_array($msgtype, ['m.text', 'm.emote'], true) && is_string($content['body'] ?? null) && $content['body'] !== '') {
            return $content['body'];
        }

        return 'Loại tin chưa hỗ trợ: '.(self::UNSUPPORTED_LABELS[$msgtype] ?? 'khác');
    }

    private function preview(string $body, bool $hasImage): string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $body) ?? $body);

        return $text === '' && $hasImage ? self::IMAGE_ONLY_PREVIEW : Str::limit($text, self::PREVIEW_LENGTH);
    }

    /**
     * The `mxc://` URI of an image or sticker event, or null for any other event.
     *
     * @param  MatrixEvent  $event
     */
    private function imageUri(array $event): ?string
    {
        $content = is_array($event['content'] ?? null) ? $event['content'] : [];
        $isImage = ($event['type'] ?? null) === 'm.sticker'
            || (($event['type'] ?? null) === 'm.room.message' && ($content['msgtype'] ?? null) === 'm.image');

        if (! $isImage) {
            return null;
        }

        // * An encrypted attachment (`file`) is not readable here (encryption is off); it still counts as an image that failed to load.
        return is_string($content['url'] ?? null) ? $content['url'] : '';
    }

    /**
     * The `mxc://` URI of a voice message event, or null for any other event.
     *
     * @param  MatrixEvent  $event
     */
    private function audioUri(array $event): ?string
    {
        $content = is_array($event['content'] ?? null) ? $event['content'] : [];

        if (($event['type'] ?? null) !== 'm.room.message' || ($content['msgtype'] ?? null) !== 'm.audio') {
            return null;
        }

        return is_string($content['url'] ?? null) ? $content['url'] : '';
    }

    /**
     * The `mxc://` URI of a video message event, or null for any other event.
     *
     * @param  MatrixEvent  $event
     */
    private function videoUri(array $event): ?string
    {
        $content = is_array($event['content'] ?? null) ? $event['content'] : [];

        if (($event['type'] ?? null) !== 'm.room.message' || ($content['msgtype'] ?? null) !== 'm.video') {
            return null;
        }

        return is_string($content['url'] ?? null) ? $content['url'] : '';
    }

    /**
     * Keeps only the `mxc://` reference of a video (relayed, never stored); the type is the declared one limited to a
     * whitelist, and the name is the event body trimmed to a plain file name.
     *
     * @param  MatrixEvent  $event
     * @return array{attachment_mxc: string, attachment_mime: string, attachment_size: int|null, attachment_name: string|null, attachment_width: int|null, attachment_height: int|null}|null
     */
    private function videoAttachment(array $event, string $mxcUri): ?array
    {
        if (preg_match('#^mxc://[A-Za-z0-9.:\-]+/[A-Za-z0-9_\-]+$#D', $mxcUri) !== 1) {
            return null;
        }

        $content = is_array($event['content'] ?? null) ? $event['content'] : [];
        $info = is_array($content['info'] ?? null) ? $content['info'] : [];
        $declared = is_string($info['mimetype'] ?? null) ? strtolower(explode(';', $info['mimetype'])[0]) : '';
        $body = is_string($content['body'] ?? null) ? basename(str_replace('\\', '/', $content['body'])) : '';

        return [
            'attachment_mxc' => $mxcUri,
            'attachment_mime' => in_array($declared, MatrixClient::VIDEO_MIMES, true) ? $declared : 'video/mp4',
            'attachment_size' => is_int($info['size'] ?? null) ? $info['size'] : null,
            'attachment_name' => $body === '' ? null : Str::limit($body, 255, ''),
            'attachment_width' => is_int($info['w'] ?? null) ? $info['w'] : null,
            'attachment_height' => is_int($info['h'] ?? null) ? $info['h'] : null,
        ];
    }

    /**
     * Turns a message saved as "Loại tin chưa hỗ trợ: tin nhắn thoại" into a playable one by re-reading its event.
     */
    public function backfillVoice(ChatMessage $message): bool
    {
        $conversation = $message->conversation;

        if ($message->external_message_id === null || $conversation === null) {
            return false;
        }

        try {
            $event = $this->matrix->event($conversation->external_chat_id, $message->external_message_id);
        } catch (MatrixException|ConnectionException) {
            return false;
        }

        $uri = $this->audioUri($event);
        $attachment = $uri === null ? null : $this->audioAttachment($event, $uri);

        if ($attachment === null) {
            return false;
        }

        $message->forceFill(['body' => '', ...$attachment])->save();

        return true;
    }

    /**
     * Keeps only the `mxc://` reference of a voice message; the type is the declared one limited to a whitelist (it only
     * picks the `Content-Type` of the relayed stream and never reaches a path).
     *
     * @param  MatrixEvent  $event
     * @return array{attachment_mxc: string, attachment_mime: string, attachment_size: int|null}|null
     */
    private function audioAttachment(array $event, string $mxcUri): ?array
    {
        if (preg_match('#^mxc://[A-Za-z0-9.:\-]+/[A-Za-z0-9_\-]+$#D', $mxcUri) !== 1) {
            return null;
        }

        $content = is_array($event['content'] ?? null) ? $event['content'] : [];
        $info = is_array($content['info'] ?? null) ? $content['info'] : [];
        $declared = is_string($info['mimetype'] ?? null) ? strtolower(explode(';', $info['mimetype'])[0]) : '';
        $mime = self::AUDIO_ALIASES[$declared] ?? $declared;

        return [
            'attachment_mxc' => $mxcUri,
            'attachment_mime' => in_array($mime, MatrixClient::AUDIO_MIMES, true) ? $mime : 'audio/mp4',
            'attachment_size' => is_int($info['size'] ?? null) ? $info['size'] : null,
        ];
    }

    /**
     * Downloads and stores the image; any failure yields null so the message is saved as a placeholder and the batch goes on.
     *
     * @return array{attachment_path: string, attachment_mime: string, attachment_size: int, attachment_width: int, attachment_height: int}|null
     */
    private function downloadImage(Conversation $conversation, string $mxcUri): ?array
    {
        $image = $this->fetchAndStore('chat/'.$conversation->id, $mxcUri, self::MAX_IMAGE_BYTES);

        return $image === null ? null : [
            'attachment_path' => $image['path'],
            'attachment_mime' => $image['mime'],
            'attachment_size' => $image['size'],
            'attachment_width' => $image['width'],
            'attachment_height' => $image['height'],
        ];
    }

    /** @return array{path: string, mime: string, size: int, width: int, height: int}|null */
    private function fetchAndStore(string $directory, string $mxcUri, int $maxBytes): ?array
    {
        try {
            $image = $this->matrix->downloadImage($mxcUri, $maxBytes);
        } catch (MatrixException|ConnectionException) {
            // * Never log: the exception or URI may carry the media id or token context.
            return null;
        }

        $path = $directory.'/'.Str::uuid()->toString().'.'.self::IMAGE_EXTENSIONS[$image['mime']];

        if (! Storage::disk(self::ATTACHMENT_DISK)->put($path, $image['data'])) {
            return null;
        }

        return ['path' => $path, 'mime' => $image['mime'], 'size' => strlen($image['data']), 'width' => $image['width'], 'height' => $image['height']];
    }

    /**
     * Stores the customer's profile picture when the batch carries room state with one that differs from the stored
     * source. A failed download keeps the previous picture (or none) and never fails the batch.
     *
     * @param  list<MatrixEvent>  $stateEvents
     */
    private function syncAvatar(Conversation $conversation, array $stateEvents): void
    {
        $mxc = $this->avatarMxc($stateEvents);

        if ($mxc === null || $mxc === $conversation->avatar_mxc) {
            return;
        }

        $image = $this->fetchAndStore('chat/avatars/'.$conversation->id, $mxc, self::MAX_AVATAR_BYTES);

        if ($image === null) {
            return;
        }

        $previous = $conversation->avatar_path;
        $conversation->forceFill(['avatar_path' => $image['path'], 'avatar_mxc' => $mxc])->save();

        if ($previous !== null) {
            Storage::disk(self::ATTACHMENT_DISK)->delete($previous);
        }
    }

    /**
     * The customer's ghost avatar, else the room avatar (last event wins). Never the owner's own ghost, the bot or the app user.
     *
     * @param  list<MatrixEvent>  $stateEvents
     */
    private function avatarMxc(array $stateEvents): ?string
    {
        $excluded = [(string) config('services.matrix.user_id'), (string) config('services.mautrix_meta.bot_user_id')];
        $prefix = (string) config('services.mautrix_meta.ghost_prefix', '@meta_');
        $ghost = null;
        $room = null;

        foreach ($stateEvents as $event) {
            $content = is_array($event['content'] ?? null) ? $event['content'] : [];
            $type = $event['type'] ?? null;
            $stateKey = $event['state_key'] ?? null;

            if ($type === 'm.room.avatar' && is_string($content['url'] ?? null) && $content['url'] !== '') {
                $room = $content['url'];
            }

            if ($type === 'm.room.member' && is_string($stateKey) && str_starts_with($stateKey, $prefix) && ! in_array($stateKey, $excluded, true) && ! isset($this->selfGhosts[$stateKey])
                && ($content['membership'] ?? null) === 'join' && is_string($content['avatar_url'] ?? null) && $content['avatar_url'] !== '') {
                $ghost = $content['avatar_url'];
            }
        }

        return $ghost ?? $room;
    }

    /**
     * The account's own profile picture from its ghost's member event (state or timeline), downloaded only when the mxc changed.
     *
     * @param  list<MatrixEvent>  $events
     */
    private function syncAccountAvatar(?MessengerAccount $account, array $events): void
    {
        if ($account === null) {
            return;
        }

        $ghostId = array_search($account, $this->selfGhosts, true);
        $mxc = null;

        foreach ($events as $event) {
            $content = is_array($event['content'] ?? null) ? $event['content'] : [];

            if (($event['type'] ?? null) === 'm.room.member' && ($event['state_key'] ?? null) === $ghostId
                && ($content['membership'] ?? null) === 'join' && is_string($content['avatar_url'] ?? null) && $content['avatar_url'] !== '') {
                $mxc = $content['avatar_url'];
            }
        }

        if ($mxc === null || $mxc === $account->avatar_mxc) {
            return;
        }

        $image = $this->fetchAndStore('chat/avatars/accounts/'.$account->id, $mxc, self::MAX_AVATAR_BYTES);

        if ($image === null) {
            return;
        }

        $previous = $account->avatar_path;
        $account->forceFill(['avatar_path' => $image['path'], 'avatar_mxc' => $mxc])->save();

        if ($previous !== null) {
            Storage::disk(self::ATTACHMENT_DISK)->delete($previous);
        }
    }

    /**
     * Matrix puts the file name in `body` unless `filename` is set and differs, in which case `body` is the caption.
     * A stored image keeps only the caption; a failed one keeps a placeholder (plus the caption).
     *
     * @param  MatrixEvent  $event
     */
    private function imageBody(array $event, bool $stored): string
    {
        $content = is_array($event['content'] ?? null) ? $event['content'] : [];
        $body = $content['body'] ?? null;
        $filename = $content['filename'] ?? null;
        $isSticker = ($event['type'] ?? null) === 'm.sticker';
        $caption = ! $isSticker && is_string($body) && is_string($filename) && trim($body) !== '' && $body !== $filename ? trim($body) : '';

        if ($stored) {
            return $caption;
        }

        return $caption === '' ? self::IMAGE_FAILED_BODY : self::IMAGE_FAILED_BODY."\n".$caption;
    }
}
