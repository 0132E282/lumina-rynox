<?php

namespace App\Console\Commands;

use App\Models\ChatMessage;
use App\Services\Chat\Messenger\MessengerInbox;
use Illuminate\Console\Command;

class BackfillVoiceMessagesCommand extends Command
{
    protected $signature = 'chat:backfill-voice';

    protected $description = 'Make Messenger voice messages saved as "chưa hỗ trợ" playable';

    public function handle(MessengerInbox $inbox): int
    {
        $fixed = 0;
        $total = 0;

        ChatMessage::query()
            ->where('body', 'Loại tin chưa hỗ trợ: tin nhắn thoại')
            ->whereNull('attachment_mxc')
            ->with('conversation')
            ->each(function (ChatMessage $message) use ($inbox, &$fixed, &$total): void {
                $total++;
                $fixed += $inbox->backfillVoice($message) ? 1 : 0;
            });

        $this->info("Đã khôi phục {$fixed}/{$total} tin nhắn thoại.");

        return self::SUCCESS;
    }
}
