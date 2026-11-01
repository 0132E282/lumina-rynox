<?php

declare(strict_types=1);

namespace App\Services\Chat\Messenger;

use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\MessengerAccount;
use Illuminate\Support\Facades\Storage;

/** * Removes the conversations of one Messenger account (messages go with them) and the files they stored on disk. */
final class MessengerConversationPurger
{
    /** @return int conversations deleted */
    public function purge(MessengerAccount $account): int
    {
        $disk = Storage::disk(ChatMessage::ATTACHMENT_DISK);
        $conversations = Conversation::query()->where('messenger_account_id', $account->id);

        (clone $conversations)->select(['id', 'avatar_path'])->chunkById(100, function ($chunk) use ($disk): void {
            foreach ($chunk as $conversation) {
                ChatMessage::query()->where('conversation_id', $conversation->id)->whereNotNull('attachment_path')->pluck('attachment_path')
                    ->each(fn (string $path) => $disk->delete($path));

                if ($conversation->avatar_path !== null) {
                    $disk->delete($conversation->avatar_path);
                }
            }
        }, 'id');

        return $conversations->delete();
    }
}
