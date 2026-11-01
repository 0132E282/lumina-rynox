<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Conversation;
use App\Models\Integration;
use App\Models\MessengerAccount;
use App\Services\Chat\Messenger\MessengerConversationPurger;
use Illuminate\Console\Command;

class PurgeDisconnectedMessengerChatsCommand extends Command
{
    protected $signature = 'chat:purge-disconnected {--force : Delete without asking}';

    protected $description = 'Delete the conversations and messages of Messenger accounts that are already disconnected';

    public function handle(MessengerConversationPurger $purger): int
    {
        $accounts = MessengerAccount::query()->where('status', Integration::STATUS_DISCONNECTED)->get()
            ->mapWithKeys(fn (MessengerAccount $account): array => [$account->id => [$account, Conversation::query()->where('messenger_account_id', $account->id)->count()]])
            ->filter(fn (array $row): bool => $row[1] > 0);

        if ($accounts->isEmpty()) {
            $this->info('Không có hội thoại nào của tài khoản đã ngắt kết nối.');

            return self::SUCCESS;
        }

        foreach ($accounts as [$account, $count]) {
            $this->line("Tài khoản #{$account->id} ".($account->name ?? '(chưa có tên)').": {$count} hội thoại");
        }

        if (! $this->option('force') && ! $this->confirm('Xoá vĩnh viễn các hội thoại, tin nhắn và file trên?')) {
            return self::FAILURE;
        }

        foreach ($accounts as [$account]) {
            $this->info("Đã xoá {$purger->purge($account)} hội thoại của tài khoản #{$account->id}.");
        }

        return self::SUCCESS;
    }
}
