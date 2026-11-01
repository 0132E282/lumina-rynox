<?php

declare(strict_types=1);

namespace App\Services\Chat\Messenger;

use App\Models\Conversation;
use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\ChatChannelDriver;
use App\Services\Chat\ChatSender;

/** * Registers Messenger in the host's `ChatChannels`: its sender, channel-level state and per-conversation account. */
final class MessengerChatChannel implements ChatChannelDriver
{
    public function __construct(
        private readonly MessengerSender $sender,
        private readonly MessengerChannel $channel,
    ) {}

    public function provider(): string
    {
        return MessengerChannel::PROVIDER;
    }

    public function label(): string
    {
        return 'Messenger';
    }

    public function sender(): ChatSender
    {
        return $this->sender;
    }

    public function presentChannel(?Integration $integration): array
    {
        $accounts = $integration === null ? collect() : $this->channel->accounts($integration);

        return [
            'display_name' => null,
            // * The account is named per conversation; this is only the fallback when exactly one account exists.
            'account' => $accounts->count() === 1 ? $accounts->first()?->name : null,
            'account_count' => $accounts->count(),
            'can_send' => $integration !== null && $accounts->contains(fn (MessengerAccount $account): bool => $account->allows('reply')),
        ];
    }

    /** @return list<string> */
    public function conversationRelations(): array
    {
        return ['messengerAccount'];
    }

    public function presentConversation(Conversation $conversation): array
    {
        /** @var MessengerAccount|null $account */
        $account = $conversation->getRelationValue('messengerAccount');

        return ['account' => $account === null ? null : [
            'id' => $account->id,
            'name' => $account->name,
            // * Version in the query so a changed picture bypasses the browser cache.
            'avatar_url' => $account->avatar_path === null ? null : route('chat.account-avatar', $account, false).'?v='.substr(md5($account->avatar_path), 0, 8),
        ]];
    }
}
