<?php

declare(strict_types=1);

namespace App\Services\Chat\Zalo;

use App\Models\Conversation;
use App\Models\Integration;
use App\Models\ZaloAccount;
use App\Services\Chat\ChatChannelDriver;
use App\Services\Chat\ChatSender;

/** * Registers Zalo in `ChatChannels`: its sender, channel-level state and the per-conversation account (same `account` key as Messenger). */
final class ZaloChatChannel implements ChatChannelDriver
{
    public function __construct(
        private readonly ZaloSender $sender,
        private readonly ZaloChannel $channel,
    ) {}

    public function provider(): string
    {
        return ZaloChannel::PROVIDER;
    }

    public function label(): string
    {
        return 'Zalo';
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
            'can_send' => $integration !== null && $accounts->contains(fn (ZaloAccount $account): bool => $account->allows('reply')),
        ];
    }

    /** @return list<string> */
    public function conversationRelations(): array
    {
        return ['zaloAccount'];
    }

    public function presentConversation(Conversation $conversation): array
    {
        /** @var ZaloAccount|null $account */
        $account = $conversation->getRelationValue('zaloAccount');

        return ['account' => $account === null ? null : [
            'id' => $account->id,
            'name' => $account->name,
            'avatar_url' => null,
        ]];
    }
}
