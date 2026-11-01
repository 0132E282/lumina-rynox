<?php

declare(strict_types=1);

namespace App\Services\Chat\Zalo;

use App\Models\Conversation;
use App\Models\Integration;
use App\Models\ZaloAccount;
use App\Services\Chat\Telegram\ChatUnavailableException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Pulls the address book (friends and groups) of ONE Zalo account from the sidecar and makes sure each one has a `Conversation` of that account, so `/chat`
 * lists them before any message arrives. Names only: no `ChatMessage` is created and no message history is fetched.
 * Idempotent: a contact that already has a conversation keeps its messages and preview; only a real name updates the title.
 * ! Names are personal data: never log them.
 */
final class ZaloContactSync
{
    // * Hard cap on rows handled per run, whatever the sidecar sends.
    private const MAX_CONTACTS = 6000;

    private const CHUNK_SIZE = 500;

    public function __construct(
        private readonly ZaloChannel $channel,
        private readonly ZaloBridgeClient $bridge,
    ) {}

    /**
     * @return array{friends: int, groups: int, created: int, updated: int, truncated: bool}
     *
     * @throws ChatUnavailableException the channel is not signed in
     * @throws ConnectionException
     * @throws ZaloBridgeException
     */
    public function sync(ZaloAccount $account): array
    {
        if ($account->status !== Integration::STATUS_CONNECTED || $this->channel->credentials($account) === null) {
            throw new ChatUnavailableException('Tài khoản Zalo chưa kết nối, hãy quét mã QR trước.');
        }

        $answer = $this->bridge->contacts($account->account_key);
        $contacts = $this->unique(array_slice($answer['contacts'], 0, self::MAX_CONTACTS));
        $created = 0;
        $updated = 0;

        foreach (array_chunk($contacts, self::CHUNK_SIZE) as $chunk) {
            [$chunkCreated, $chunkUpdated] = $this->store($account, $chunk);
            $created += $chunkCreated;
            $updated += $chunkUpdated;
        }

        $friends = count(array_filter($contacts, fn (array $contact): bool => $contact['type'] === 'user'));
        $result = [
            'friends' => $friends,
            'groups' => count($contacts) - $friends,
            'created' => $created,
            'updated' => $updated,
            'truncated' => $answer['truncated'] || count($answer['contacts']) > self::MAX_CONTACTS,
        ];

        $account->forceFill(['contacts_synced_at' => now()])->save();

        return $result;
    }

    /**
     * @param  list<array{thread_id: string, type: string, name: string}>  $contacts
     * @return list<array{thread_id: string, type: string, name: string}>
     */
    private function unique(array $contacts): array
    {
        $byId = [];

        foreach ($contacts as $contact) {
            $id = trim($contact['thread_id']);

            if ($id !== '' && strlen($id) <= 64) {
                $byId[$id] ??= ['thread_id' => $id, 'type' => $contact['type'], 'name' => trim($contact['name'])];
            }
        }

        return array_values($byId);
    }

    /**
     * @param  list<array{thread_id: string, type: string, name: string}>  $chunk
     * @return array{0: int, 1: int} created and updated rows
     */
    private function store(ZaloAccount $account, array $chunk): array
    {
        return DB::transaction(function () use ($account, $chunk): array {
            $existing = Conversation::query()
                ->where('provider', ZaloChannel::PROVIDER)
                ->where('account_scope', $account->id)
                ->whereIn('external_chat_id', array_column($chunk, 'thread_id'))
                ->get()
                ->keyBy('external_chat_id');
            $now = now();
            $rows = [];
            $updated = 0;

            foreach ($chunk as $contact) {
                $name = Str::limit($contact['name'], 255, '');
                $conversation = $existing->get($contact['thread_id']);

                if ($conversation === null) {
                    $rows[] = [
                        // * A bulk insert skips the model, so the UUID is generated here.
                        'id' => (string) Str::uuid7(),
                        'integration_id' => $account->integration_id,
                        'zalo_account_id' => $account->id,
                        'account_scope' => $account->id,
                        'provider' => ZaloChannel::PROVIDER,
                        'external_chat_id' => $contact['thread_id'],
                        'type' => $contact['type'] === 'group' ? Conversation::TYPE_GROUP : Conversation::TYPE_PRIVATE,
                        'title' => $name !== '' ? $name : 'Zalo '.$contact['thread_id'],
                        'unread_count' => 0,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];

                    continue;
                }

                // * An empty name never replaces a known title; a message's own data (preview, unread) is left alone.
                if ($name !== '' && $conversation->title !== $name) {
                    $conversation->forceFill(['title' => $name, 'integration_id' => $account->integration_id])->save();
                    $updated++;
                }
            }

            // * `insertOrIgnore` keeps the unique (provider, external_chat_id, account_scope) safe if a message created the row meanwhile.
            $created = $rows === [] ? 0 : Conversation::query()->insertOrIgnore($rows);

            return [$created, $updated];
        });
    }
}
