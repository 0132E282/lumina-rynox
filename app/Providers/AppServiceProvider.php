<?php

namespace App\Providers;

use App\Events\ChatChanged;
use App\Jobs\AutoReplyJob;
use App\Models\ChatMessage;
use App\Models\Conversation;
use App\Models\Integration;
use App\Services\Ai\AgentWorkspace;
use App\Services\Ai\AutoReplySwitch;
use App\Services\Ai\ChatActivity;
use App\Services\Ai\ChatImages;
use App\Services\Ai\McpPolicy;
use App\Services\Chat\ChatChannels;
use App\Services\Chat\ChatRealtime;
use App\Services\Chat\Messenger\MessengerChatChannel;
use App\Services\Chat\Zalo\ZaloChatChannel;
use App\Services\Mail\Imap\ImapClient;
use App\Services\Mail\Imap\WebklexImapClient;
use App\Services\Mail\Security\DnsResolver;
use App\Services\Mail\Security\SystemDnsResolver;
use App\Services\Mail\Smtp\SmtpTransport;
use App\Services\Mail\Smtp\SymfonySmtpTransport;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\DevCommands;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(ChatRealtime::class);
        $this->app->scoped(McpPolicy::class);
        $this->app->scoped(ChatImages::class);
        $this->app->scoped(ChatActivity::class);
        $this->app->scoped(AgentWorkspace::class);

        // * Zalo and Messenger join the chat channel registry (Telegram is wired directly in `ChatChannels`); Zalo is listed first.
        $this->app->singleton(ZaloChatChannel::class);
        $this->app->singleton(MessengerChatChannel::class);
        $this->callAfterResolving(ChatChannels::class, function (ChatChannels $channels): void {
            $channels->register($this->app->make(ZaloChatChannel::class));
            $channels->register($this->app->make(MessengerChatChannel::class));
        });

        // * Mail module: interfaces so tests swap in fakes (no real IMAP/SMTP/DNS). Not singletons: a transport holds one SMTP session.
        $this->app->bind(DnsResolver::class, SystemDnsResolver::class);
        $this->app->bind(ImapClient::class, WebklexImapClient::class);
        $this->app->bind(SmtpTransport::class, SymfonySmtpTransport::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();
        $this->registerChatRealtime();

        // * `php artisan dev` also runs the Messenger long-poll `/sync` (messages arrive within seconds); the scheduler's once-a-minute
        // * `--once` call stays as a fallback and skips itself while this loop holds the lock. Production needs the same loop under a supervisor.
        DevCommands::artisan('chat:matrix-sync', 'matrix');
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(12)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised()
            : null,
        );
    }

    /**
     * Signal /chat when chat data changes through Eloquent. Query-builder writes and `meta`-only changes
     * (telegram offset, bridge state) deliberately do not signal.
     */
    protected function registerChatRealtime(): void
    {
        ChatMessage::created(function (ChatMessage $message): void {
            app(ChatRealtime::class)->touch(ChatChanged::KIND_MESSAGE_CREATED, $message->conversation_id);

            // * Single point where every channel's inbound text lands (Telegram, Zalo, Messenger): queue the automatic reply; the job re-checks every guard.
            if ($message->direction === ChatMessage::DIRECTION_IN && $message->sender_type === ChatMessage::SENDER_CUSTOMER && app(AutoReplySwitch::class)->enabled()) {
                AutoReplyJob::dispatch($message->id);
            }
        });

        ChatMessage::updated(function (ChatMessage $message): void {
            if ($message->wasChanged('send_status')) {
                app(ChatRealtime::class)->touch(ChatChanged::KIND_MESSAGE_STATUS, $message->conversation_id);
            }
        });

        Conversation::created(fn (Conversation $conversation) => app(ChatRealtime::class)
            ->touch(ChatChanged::KIND_CONVERSATION_UPDATED, $conversation->id));

        Conversation::updated(function (Conversation $conversation): void {
            if ($conversation->wasChanged(['title', 'username', 'unread_count', 'last_message_at', 'last_message_preview', 'pinned_at'])) {
                app(ChatRealtime::class)->touch(ChatChanged::KIND_CONVERSATION_UPDATED, $conversation->id);
            }
        });

        Integration::saved(function (Integration $integration): void {
            $isChatChannel = in_array($integration->provider, app(ChatChannels::class)->providers(), true);

            if ($isChatChannel && ($integration->wasRecentlyCreated || $integration->wasChanged(['status', 'last_error', 'settings']))) {
                app(ChatRealtime::class)->touch(ChatChanged::KIND_CHANNEL_STATUS);
            }
        });
    }
}
