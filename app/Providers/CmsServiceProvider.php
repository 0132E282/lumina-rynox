<?php

declare(strict_types=1);

namespace App\Providers;

use App\Models\Admin;
use App\Models\Conversation;
use App\Models\Mailbox;
use App\Models\MailFolder;
use App\Models\MailMessage;
use App\Models\Setting;
use App\Notifications\AdminLoggedInNotification;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\Events\Logout;
use Illuminate\Database\QueryException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\ColumnDefinition;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\ServiceProvider;
use Inertia\Inertia;
use Opcodes\LogViewer\Facades\LogViewer;
use Throwable;

class CmsServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->registerBlueprintMacros();

        Event::listen(fn (Login $event) => $this->trackLogin($event->user));
        Event::listen(fn (Logout $event) => $this->trackLogout($event->user));

        LogViewer::auth(fn () => Auth::check());

        Application::macro('setting', fn (string $key, mixed $default = null) => Setting::get($key, $default));

        Inertia::share([
            'navigation' => fn () => [
                'main' => $this->navigationGroups(),
            ],
            'systemSettings' => fn () => collect(config('views.systems'))
                ->filter(fn (array $item) => $item['enable'] ?? true)
                ->values(),
        ]);

        $this->configureMailFromSettings();
    }

    /**
     * Sidebar groups from `config/views.php`; the unread badge source is resolved here.
     *
     * @return list<array<string, mixed>>
     */
    private function navigationGroups(): array
    {
        $groups = [];

        foreach (config('views.sidebar.main', []) as $group) {
            if (empty($group['items'])) {
                continue;
            }

            $items = [];

            foreach ($group['items'] as $item) {
                if (($item['badge_source'] ?? null) === 'chat_unread') {
                    $item['badge'] = $this->chatUnreadCount();
                }

                if (($item['badge_source'] ?? null) === 'inbox_unread') {
                    $item['badge'] = $this->chatUnreadCount() + $this->mailUnreadCount();
                }

                if (($item['badge_source'] ?? null) === 'mail_unread') {
                    $item['badge'] = $this->mailUnreadCount();
                }

                unset($item['badge_source']);
                $items[] = $item;
            }

            $group['items'] = $items;
            $groups[] = $group;
        }

        return $groups;
    }

    /** * Unread total for the Chat badge. Before the table exists (migration not run yet) it reads as zero. */
    private function chatUnreadCount(): int
    {
        try {
            return (int) Conversation::query()->sum('unread_count');
        } catch (QueryException) {
            return 0;
        }
    }

    /** * Unread INBOX mail of mailboxes that are not disconnected, for the Email badge. Before the tables exist it reads as zero. */
    private function mailUnreadCount(): int
    {
        try {
            return MailMessage::query()
                ->where('seen', false)
                ->whereIn('mail_folder_id', MailFolder::query()
                    ->where('role', MailFolder::ROLE_INBOX)
                    ->whereIn('mailbox_id', Mailbox::query()->where('status', '!=', Mailbox::STATUS_DISCONNECTED)->select('id'))
                    ->select('id'))
                ->count();
        } catch (QueryException) {
            return 0;
        }
    }

    /** * `multilingual()` stores a locale map when the app has more than one configured locale, a plain string otherwise. */
    private function registerBlueprintMacros(): void
    {
        Blueprint::macro('multilingual', function (string $column): ColumnDefinition {
            /** @var Blueprint $this */
            $locales = config('app.locales', []);
            if (count($locales) > 1) {
                return $this->json($column)->nullable();
            }

            return $this->string($column)->nullable();
        });
    }

    /** * SMTP settings saved in the admin override `config/mail.php`; falls back to .env when unset. */
    private function configureMailFromSettings(): void
    {
        try {
            if (! Schema::hasTable('settings')) {
                return;
            }
        } catch (Throwable) {
            return;
        }

        $host = Setting::get('mail.host');

        if (blank($host)) {
            return;
        }

        config([
            'mail.default' => 'smtp',
            'mail.mailers.smtp.host' => $host,
            'mail.mailers.smtp.port' => Setting::get('mail.port', 587),
            'mail.mailers.smtp.username' => Setting::get('mail.username'),
            'mail.mailers.smtp.password' => Setting::get('mail.password'),
            'mail.mailers.smtp.encryption' => Setting::get('mail.encryption'),
            'mail.from.address' => Setting::get('mail.from_address', config('mail.from.address')),
            'mail.from.name' => Setting::get('mail.from_name', config('mail.from.name')),
        ]);
    }

    private function trackLogin(mixed $user): void
    {
        if (! $user instanceof Admin) {
            return;
        }

        $user->forceFill([
            'last_login_at' => now(),
            'last_login_ip' => Request::ip(),
            'last_seen_at' => now(),
        ])->save();

        activity()
            ->causedBy($user)
            ->event('login')
            ->log("{$user->name} đã đăng nhập.");

        $user->notify(new AdminLoggedInNotification(Request::ip()));
    }

    private function trackLogout(mixed $user): void
    {
        if (! $user instanceof Admin) {
            return;
        }

        $user->forceFill(['last_seen_at' => null])->save();

        activity()
            ->causedBy($user)
            ->event('logout')
            ->log("{$user->name} đã đăng xuất.");
    }
}
