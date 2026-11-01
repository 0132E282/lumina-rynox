<?php

declare(strict_types=1);

namespace Tests\Feature\Inbox;

use App\Models\Admin;
use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Mailbox;
use App\Models\MailFolder;
use App\Models\MailMessage;
use App\Services\Mail\Exceptions\MailException;
use App\Services\Mail\Imap\ImapClient;
use App\Services\Mail\Imap\ImapSession;
use App\Services\Mail\MailboxConnection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

class InboxTest extends TestCase
{
    use RefreshDatabase;

    private Mailbox $mailbox;

    private MailFolder $inbox;

    protected function setUp(): void
    {
        parent::setUp();

        $this->mailbox = Mailbox::factory()->create(['email' => 'shop@example.test']);
        $this->inbox = MailFolder::query()->create(['mailbox_id' => $this->mailbox->id, 'role' => MailFolder::ROLE_INBOX, 'name' => 'INBOX']);
    }

    public function test_it_merges_chat_and_mail_newest_first_with_a_channel_field(): void
    {
        $this->conversation('telegram', 'Khách Telegram', '2026-10-31 10:00:00');
        $this->mail('Hóa đơn', 'Kế toán', '2026-10-31 11:00:00');
        $this->conversation('zalo', 'Khách Zalo', '2026-10-31 09:00:00');
        $this->conversation('zalo', 'Chưa nhắn', null);

        $this->actingAs($this->admin(['conversations.view', 'mail.view']))
            ->get(route('inbox.index'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('inbox/index')
                ->tap(fn (Assert $inner) => $this->assertSame(['Kế toán', 'Khách Telegram', 'Khách Zalo', 'Chưa nhắn'], Arr::pluck($inner->toArray()['props']['items']['data'], 'title')))
                ->tap(fn (Assert $inner) => $this->assertSame(['email', 'telegram', 'zalo', 'zalo'], Arr::pluck($inner->toArray()['props']['items']['data'], 'channel')))
                ->tap(fn (Assert $inner) => $this->assertSame(['mail', 'chat', 'chat', 'chat'], Arr::pluck($inner->toArray()['props']['items']['data'], 'kind')))
                ->where('items.total', 4));
    }

    public function test_the_channel_tabs_come_from_the_registered_chat_providers_with_one_zalo_tab(): void
    {
        $this->actingAs($this->admin(['conversations.view', 'mail.view']))
            ->get(route('inbox.index'))
            ->assertInertia(fn (Assert $page) => $page
                ->tap(fn (Assert $inner) => $this->assertSame(['email', 'zalo', 'messenger', 'telegram'], Arr::pluck($inner->toArray()['props']['channelTabs'], 'key')))
                ->tap(fn (Assert $inner) => $this->assertSame(['Email', 'Zalo', 'Facebook', 'Telegram'], Arr::pluck($inner->toArray()['props']['channelTabs'], 'label'))));
    }

    public function test_each_channel_tab_carries_its_unread_message_count(): void
    {
        $this->conversation('zalo', 'Bạn Zalo', '2026-10-31 10:00:00', unread: 2);
        $this->conversation('zalo', 'Nhóm Zalo', '2026-10-31 09:30:00', type: 'group', unread: 3);
        $this->conversation('telegram', 'Bạn TG', '2026-10-31 08:30:00', unread: 1);
        $this->conversation('messenger', 'Đã đọc hết', '2026-10-31 08:00:00');
        $this->mail('Chưa xem', 'A', '2026-10-31 07:00:00');
        $this->mail('Đã xem', 'B', '2026-10-31 06:00:00', seen: true);

        $this->actingAs($this->admin(['conversations.view', 'mail.view']))
            ->get(route('inbox.index'))
            ->assertInertia(fn (Assert $page) => $page->tap(fn (Assert $inner) => $this->assertSame(
                ['email' => 1, 'zalo' => 5, 'messenger' => 0, 'telegram' => 1],
                Arr::pluck($inner->toArray()['props']['channelTabs'], 'unread', 'key'),
            )));
    }

    public function test_the_channel_filter_splits_email_zalo_messenger_and_telegram(): void
    {
        $this->conversation('zalo', 'Bạn Zalo', '2026-10-31 10:00:00');
        $this->conversation('zalo', 'Nhóm Zalo', '2026-10-31 09:30:00', type: 'group');
        $this->conversation('messenger', 'Bạn FB', '2026-10-31 09:00:00');
        $this->conversation('telegram', 'Bạn TG', '2026-10-31 08:30:00');
        $this->mail('Chào', 'Người gửi', '2026-10-31 08:00:00');
        $admin = $this->admin(['conversations.view', 'mail.view']);

        foreach ([
            'email' => ['Người gửi'],
            'zalo' => ['Bạn Zalo', 'Nhóm Zalo'],
            'messenger' => ['Bạn FB'],
            'telegram' => ['Bạn TG'],
            'all' => ['Bạn Zalo', 'Nhóm Zalo', 'Bạn FB', 'Bạn TG', 'Người gửi'],
        ] as $channel => $titles) {
            $this->actingAs($admin)->get(route('inbox.index', ['channel' => $channel]))
                ->assertInertia(fn (Assert $page) => $page->tap(fn (Assert $inner) => $this->assertSame($titles, Arr::pluck($inner->toArray()['props']['items']['data'], 'title'), "channel {$channel}")));
        }

        $this->actingAs($admin)->get(route('inbox.index', ['channel' => 'discord']))->assertSessionHasErrors('channel');
    }

    public function test_the_unread_filter_keeps_unread_conversations_and_unseen_mail(): void
    {
        $this->conversation('telegram', 'Đã đọc', '2026-10-31 10:00:00');
        $this->conversation('telegram', 'Chưa đọc', '2026-10-31 09:00:00', unread: 3);
        $this->mail('Đã xem', 'A', '2026-10-31 08:00:00', seen: true);
        $this->mail('Chưa xem', 'B', '2026-10-31 07:00:00');

        $this->actingAs($this->admin(['conversations.view', 'mail.view']))
            ->get(route('inbox.index', ['filter' => 'unread']))
            ->assertInertia(fn (Assert $page) => $page
                ->tap(fn (Assert $inner) => $this->assertSame(['Chưa đọc', 'B'], Arr::pluck($inner->toArray()['props']['items']['data'], 'title')))
                ->tap(fn (Assert $inner) => $this->assertSame([3, 1], Arr::pluck($inner->toArray()['props']['items']['data'], 'unread_count'))));
    }

    public function test_search_matches_chat_titles_and_mail_senders_and_treats_wildcards_literally(): void
    {
        $this->conversation('telegram', 'An Nguyen', '2026-10-31 10:00:00');
        $this->conversation('telegram', '100% khách', '2026-10-31 09:00:00');
        $this->mail('Báo giá', 'An Mail', '2026-10-31 08:00:00');
        $this->mail('Khác', 'Bình', '2026-10-31 07:00:00');
        $admin = $this->admin(['conversations.view', 'mail.view']);

        $this->actingAs($admin)->get(route('inbox.index', ['q' => 'An']))
            ->assertInertia(fn (Assert $page) => $page->tap(fn (Assert $inner) => $this->assertSame(['An Nguyen', 'An Mail'], Arr::pluck($inner->toArray()['props']['items']['data'], 'title'))));
        $this->actingAs($admin)->get(route('inbox.index', ['q' => '%']))
            ->assertInertia(fn (Assert $page) => $page->tap(fn (Assert $inner) => $this->assertSame(['100% khách'], Arr::pluck($inner->toArray()['props']['items']['data'], 'title'))));
    }

    public function test_a_user_without_mail_view_does_not_see_mail_and_one_without_conversations_view_does_not_see_chat(): void
    {
        $this->conversation('telegram', 'Chat', '2026-10-31 10:00:00');
        $this->mail('Thư', 'Mail', '2026-10-31 09:00:00');

        $this->actingAs($this->admin(['conversations.view']))->get(route('inbox.index'))
            ->assertInertia(fn (Assert $page) => $page
                ->tap(fn (Assert $inner) => $this->assertSame(['Chat'], Arr::pluck($inner->toArray()['props']['items']['data'], 'title')))
                ->tap(fn (Assert $inner) => $this->assertSame(['zalo', 'messenger', 'telegram'], Arr::pluck($inner->toArray()['props']['channelTabs'], 'key')))
                ->where('can.mail', false));
        $this->actingAs($this->admin(['conversations.view']))->get(route('inbox.index', ['channel' => 'email']))->assertSessionHasErrors('channel');

        $this->actingAs($this->admin(['mail.view']))->get(route('inbox.index'))
            ->assertInertia(fn (Assert $page) => $page
                ->tap(fn (Assert $inner) => $this->assertSame(['Mail'], Arr::pluck($inner->toArray()['props']['items']['data'], 'title')))
                ->tap(fn (Assert $inner) => $this->assertSame(['email'], Arr::pluck($inner->toArray()['props']['channelTabs'], 'key')))
                ->where('can.chat', false));
    }

    public function test_a_user_with_neither_permission_gets_403_and_a_guest_is_redirected(): void
    {
        $this->actingAs($this->admin(['posts.view']))->get(route('inbox.index'))->assertForbidden();
        auth()->logout();
        $this->get(route('inbox.index'))->assertRedirect();
    }

    public function test_a_chat_thread_opens_with_its_messages_and_clears_unread_but_is_not_opened_without_permission(): void
    {
        $conversation = $this->conversation('telegram', 'Khách', '2026-10-31 10:00:00', unread: 2);
        ChatMessage::query()->create(['conversation_id' => $conversation->id, 'direction' => 'in', 'sender_type' => 'customer', 'body' => 'Xin chào', 'sent_at' => now()]);

        $this->actingAs($this->admin(['mail.view']))->get(route('inbox.index', ['c' => $conversation->id]))
            ->assertInertia(fn (Assert $page) => $page->where('activeConversation', null));
        $this->assertSame(2, $conversation->refresh()->unread_count);

        $this->actingAs($this->admin(['conversations.view']))->get(route('inbox.index', ['c' => $conversation->id]))
            ->assertInertia(fn (Assert $page) => $page
                ->where('activeConversation.id', $conversation->id)
                ->where('messages.data.0.body', 'Xin chào')
                ->where('channel.provider', 'telegram')
                ->where('can.reply', false)
                ->where('items.data.0.unread_count', 0));
        $this->assertSame(0, $conversation->refresh()->unread_count);
    }

    public function test_opening_a_mail_thread_marks_it_read_in_the_list_and_needs_mail_view(): void
    {
        $this->app->instance(ImapClient::class, new class implements ImapClient
        {
            public function open(MailboxConnection $connection): ImapSession
            {
                throw new class('Không kết nối được máy chủ.') extends MailException {};
            }
        });
        $message = $this->mail('Thư mới', 'Người gửi', '2026-10-31 10:00:00', fetched: true);

        $this->actingAs($this->admin(['conversations.view']))->get(route('inbox.index', ['m' => $message->id]))
            ->assertInertia(fn (Assert $page) => $page->where('mailThread', null));
        $this->assertFalse($message->refresh()->seen);

        $this->actingAs($this->admin(['mail.view', 'mail.send']))->get(route('inbox.index', ['m' => $message->id]))
            ->assertInertia(fn (Assert $page) => $page
                ->where('mailThread.message.id', $message->id)
                ->where('mailThread.mailbox.email', 'shop@example.test')
                ->where('mailThread.can.send', true)
                ->where('items.data.0.unread_count', 0));
    }

    public function test_the_list_costs_a_fixed_number_of_queries_however_many_rows_it_has(): void
    {
        $admin = $this->admin(['conversations.view', 'mail.view']);
        // * One row of every kind first, so both runs load the same set of relations and only the row count differs.
        foreach (['telegram', 'zalo', 'messenger'] as $provider) {
            $this->conversation($provider, "Một {$provider}", '2026-10-31 10:00:00');
        }
        $this->mail('Một', 'Một', '2026-10-31 09:00:00');

        // * The first request also loads the permission cache; warm it so the two runs are comparable.
        $this->actingAs($admin)->get(route('inbox.index'))->assertOk();
        $small = $this->queryCount(fn () => $this->get(route('inbox.index', ['filter' => 'all']))->assertOk());

        foreach (range(1, 20) as $number) {
            $this->conversation($number % 2 === 0 ? 'zalo' : 'messenger', "Khách {$number}", '2026-10-30 10:00:00');
            $this->mail("Thư {$number}", "Người {$number}", '2026-10-30 09:00:00');
        }

        $large = $this->queryCount(fn () => $this->get(route('inbox.index', ['filter' => 'all']))->assertOk());

        $this->assertSame($small, $large);
    }

    public function test_the_list_is_paginated(): void
    {
        foreach (range(1, 20) as $number) {
            $this->conversation('telegram', "Chat {$number}", sprintf('2026-10-30 10:%02d:00', $number));
            $this->mail("Thư {$number}", "Mail {$number}", sprintf('2026-10-30 09:%02d:00', $number));
        }
        $admin = $this->admin(['conversations.view', 'mail.view']);

        $this->actingAs($admin)->get(route('inbox.index'))
            ->assertInertia(fn (Assert $page) => $page->has('items.data', 30)->where('items.last_page', 2)->where('items.total', 40));
        $this->actingAs($admin)->get(route('inbox.index', ['page' => 2]))
            ->assertInertia(fn (Assert $page) => $page->has('items.data', 10)->where('items.current_page', 2));
    }

    public function test_the_communication_group_holds_only_the_inbox(): void
    {
        $this->actingAs($this->admin(['conversations.view']))->get(route('inbox.index'))
            ->assertInertia(fn (Assert $page) => $page
                ->where('navigation.main.2.items.0.url', '/inbox')
                ->missing('navigation.main.2.items.1'));
    }

    public function test_mail_actions_started_in_the_inbox_return_to_it(): void
    {
        $message = $this->mail('Thư', 'Người gửi', '2026-10-31 10:00:00', fetched: true);
        $this->app->instance(ImapClient::class, new class implements ImapClient
        {
            public function open(MailboxConnection $connection): ImapSession
            {
                throw new class('Không kết nối được máy chủ.') extends MailException {};
            }
        });
        $admin = $this->admin(['mail.view']);

        $this->actingAs($admin)->post(route('mail.unread', $message), ['from_inbox' => true])->assertRedirect(route('inbox.index'));
        $this->actingAs($admin)->post(route('mail.unread', $message))->assertRedirect(route('mail.index'));
    }

    /** @param  list<string>  $permissions */
    private function admin(array $permissions): Admin
    {
        $admin = Admin::factory()->create(['system_admin' => false]);

        foreach ($permissions as $permission) {
            $admin->givePermissionTo(Permission::findOrCreate($permission, 'web'));
        }

        return $admin;
    }

    private function conversation(string $provider, string $title, ?string $lastMessageAt, string $type = 'private', int $unread = 0): Conversation
    {
        return Conversation::query()->create([
            'provider' => $provider,
            'external_chat_id' => uniqid($provider, true),
            'type' => $type,
            'title' => $title,
            'last_message_at' => $lastMessageAt,
            'last_message_preview' => 'Tin cuối',
            'last_message_direction' => 'in',
            'unread_count' => $unread,
        ]);
    }

    private function mail(string $subject, string $from, string $receivedAt, bool $seen = false, bool $fetched = false): MailMessage
    {
        return MailMessage::factory()->create([
            'mailbox_id' => $this->mailbox->id,
            'mail_folder_id' => $this->inbox->id,
            'subject' => $subject,
            'from_name' => $from,
            'from_email' => 'sender@example.test',
            'snippet' => 'Nội dung',
            'received_at' => $receivedAt,
            'seen' => $seen,
            'body_fetched_at' => $fetched ? now() : null,
        ]);
    }

    private function queryCount(callable $request): int
    {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $request();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    }
}
