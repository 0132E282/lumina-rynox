<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Admin;
use App\Models\Conversation;
use App\Models\File;
use App\Models\MailFolder;
use App\Models\MailMessage;
use App\Models\Post;
use App\Models\SocialGroup;
use App\Models\Task;
use App\Support\GoogleAnalyticsService;
use App\Support\PersonalClock;
use App\Support\ResourcePermission;
use Closure;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\Permission\Models\Role;
use Throwable;

class DashboardController extends Controller
{
    public function index(GoogleAnalyticsService $googleAnalytics): Response
    {
        if (! $googleAnalytics->configured()) {
            return $this->render(null, false);
        }

        $result = null;
        $resolve = function () use (&$result, $googleAnalytics): array {
            return $result ??= $this->loadAnalytics($googleAnalytics);
        };

        return $this->render(
            Inertia::defer(fn () => $resolve()['analytics'], 'analytics'),
            Inertia::defer(fn () => $resolve()['analyticsError'], 'analytics'),
        );
    }

    /**
     * @return array{analytics: array<string, mixed>|null, analyticsError: bool}
     */
    private function loadAnalytics(GoogleAnalyticsService $googleAnalytics): array
    {
        try {
            return [
                'analytics' => Cache::remember(
                    'google-analytics-dashboard:'.$googleAnalytics->propertyId(),
                    now()->addMinutes(5),
                    fn () => $googleAnalytics->dashboard(),
                ),
                'analyticsError' => false,
            ];
        } catch (Throwable $exception) {
            Log::warning('Unable to load Google Analytics dashboard.', [
                'exception' => $exception,
            ]);

            return ['analytics' => null, 'analyticsError' => true];
        }
    }

    private function render(mixed $analytics, mixed $analyticsError): Response
    {
        return Inertia::render('dashboard', [
            'stats' => [
                'admins' => Admin::count(),
                'roles' => Role::count(),
                'files' => File::count(),
            ],
            'overview' => $this->overview(),
            'analytics' => $analytics,
            'analyticsError' => $analyticsError,
            ...$this->personalSummaries(),
        ]);
    }

    /**
     * Four count cards, each shown only to someone who may open the page it links to.
     *
     * @return list<array{key: string, label: string, value: int, href: string}>
     */
    private function overview(): array
    {
        $user = request()->user();
        $cards = [];

        $canChat = ResourcePermission::allows($user, 'conversations', 'view');
        $canMail = ResourcePermission::allows($user, 'mail', 'view');

        if ($canChat || $canMail) {
            $unread = ($canChat ? (int) Conversation::query()->sum('unread_count') : 0)
                + ($canMail ? MailMessage::query()->whereIn('mail_folder_id', MailFolder::query()->where('role', MailFolder::ROLE_INBOX)->select('id'))->where('seen', false)->count() : 0);
            $cards[] = ['key' => 'unread', 'label' => 'Tin chưa đọc', 'value' => $unread, 'href' => '/inbox'];
        }

        if (ResourcePermission::allows($user, 'posts', 'view')) {
            $cards[] = ['key' => 'scheduled', 'label' => 'Bài chờ đăng', 'value' => Post::query()->whereIn('status', [Post::STATUS_SCHEDULED, Post::STATUS_PUBLISHING])->count(), 'href' => '/posts'];
            $cards[] = ['key' => 'failed', 'label' => 'Bài đăng lỗi', 'value' => Post::query()->whereIn('status', [Post::STATUS_FAILED, Post::STATUS_PARTIAL, Post::STATUS_MISSED])->count(), 'href' => '/posts'];
        }

        if (ResourcePermission::allows($user, 'integrations', 'view')) {
            $cards[] = ['key' => 'groups', 'label' => 'Nhóm đã lưu', 'value' => SocialGroup::query()->whereNull('left_at')->count(), 'href' => '/social-groups'];
        }

        return $cards;
    }

    /**
     * * One deferred prop per permitted module, each in its own group so a slow or failing card never blocks the others.
     * * A prop resolving to `null` means that module's summary failed to load.
     *
     * @return array<string, mixed>
     */
    private function personalSummaries(): array
    {
        $user = request()->user();
        $loaders = [
            'tasks' => fn () => $this->taskSummary(),
        ];
        $modules = array_values(array_filter(
            array_keys($loaders),
            fn (string $module) => ResourcePermission::allows($user, $module, 'view'),
        ));

        $props = ['personalModules' => $modules];

        foreach ($modules as $module) {
            $props[$module.'Summary'] = Inertia::defer(fn () => $this->safely($module, $loaders[$module]), $module);
        }

        return $props;
    }

    private function safely(string $module, Closure $loader): mixed
    {
        try {
            return $loader();
        } catch (Throwable $exception) {
            Log::warning("Unable to load the {$module} dashboard summary.", ['exception' => $exception]);

            return null;
        }
    }

    /** @return array{pending: int, overdue: int, upcoming: array<int, array{id: int, title: string}>} */
    private function taskSummary(): array
    {
        $today = PersonalClock::today()->toDateString();
        $pending = Task::query()->where('status', 'todo');

        return [
            'pending' => (clone $pending)->count(),
            'overdue' => (clone $pending)->whereNotNull('due_date')->where('due_date', '<', $today)->count(),
            'upcoming' => (clone $pending)
                ->orderByRaw('due_date is null')
                ->orderBy('due_date')
                ->orderBy('id')
                ->limit(3)
                ->get(['id', 'title'])
                ->map(fn (Task $task) => ['id' => $task->id, 'title' => $task->title])
                ->all(),
        ];
    }
}
