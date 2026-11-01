<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\SavePostRequest;
use App\Jobs\PublishPostJob;
use App\Models\Post;
use App\Models\PostTarget;
use App\Models\SocialGroup;
use App\Services\Posting\PostProviders;
use App\Services\Posting\PostPublishingService;
use App\Support\ResourcePermission;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

/**
 * * Cross-platform posts. Routes carry `posts.{view,create,update,delete,publish}` middleware (see routes/web.php). Sending goes through
 * * `PublishPostJob::dispatchAfterResponse()` (no queue worker) and the `posts:publish-due` scheduler; a retry is always a manual action.
 *
 * @phpstan-import-type ProviderInfo from PostProviders
 */
class PostController extends Controller
{
    private const PER_PAGE = 20;

    // * `status` filter groups: key => post statuses.
    private const GROUPS = [
        'draft' => [Post::STATUS_DRAFT],
        'scheduled' => [Post::STATUS_SCHEDULED, Post::STATUS_PUBLISHING],
        'published' => [Post::STATUS_PUBLISHED],
        'failed' => [Post::STATUS_FAILED, Post::STATUS_PARTIAL, Post::STATUS_MISSED],
    ];

    private const EXCERPT_LENGTH = 140;

    private const COPY_SUFFIX = ' (bản sao)';

    public function __construct(private readonly PostProviders $providers) {}

    public function index(Request $request): Response
    {
        $validated = $request->validate([
            'status' => ['nullable', 'in:all,'.implode(',', array_keys(self::GROUPS))],
            // * One exact post status (finer than the tab groups, e.g. `partial` or `missed`); wins over `status` when both are sent.
            'state' => ['nullable', 'in:'.implode(',', array_keys(Post::STATUS_LIST))],
            'provider' => ['nullable', 'in:'.implode(',', $this->providers->keys())],
            'q' => ['nullable', 'string', 'max:100'],
        ]);
        $status = $validated['status'] ?? 'all';
        $state = $validated['state'] ?? null;
        $provider = $validated['provider'] ?? null;
        $search = trim((string) ($validated['q'] ?? ''));
        $providers = $this->providers->all();

        $paginator = Post::query()
            ->with('targets.group')
            ->when($state !== null, fn ($query) => $query->where('status', $state))
            ->when($state === null && $status !== 'all', fn ($query) => $query->whereIn('status', self::GROUPS[$status]))
            ->when($provider !== null, fn ($query) => $query->whereHas('targets', fn ($inner) => $inner->where('provider', $provider)))
            ->when($search !== '', function ($query) use ($search) {
                // * `!` is the escape character, declared in SQL: `\` as an escape is MySQL-only, so `%` and `_` would match anything elsewhere.
                $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%';

                $query->where(fn ($inner) => $inner->whereRaw("title like ? escape '!'", [$like])->orWhereRaw("body like ? escape '!'", [$like]));
            })
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        // * Tab counts: every post, and the posts that target each platform (a post on two platforms counts under both).
        $providerCounts = PostTarget::query()->selectRaw('provider, count(distinct post_id) as total')->groupBy('provider')->pluck('total', 'provider');
        $user = $request->user();

        return Inertia::render('posts/index', [
            'posts' => $paginator->through(fn (Post $post): array => $this->present($post, $providers))->toArray(),
            'filters' => ['status' => $state === null ? $status : 'all', 'state' => $state, 'provider' => $provider, 'q' => $search],
            'counts' => [
                'all' => Post::query()->count(),
                'providers' => collect($providers)->mapWithKeys(fn (array $info): array => [$info['key'] => (int) ($providerCounts[$info['key']] ?? 0)])->all(),
            ],
            // * Only registered platforms get a tab: connected ones, plus any that already has posts (so old posts stay reachable).
            'providers' => array_values(array_map(
                fn (array $info): array => ['key' => $info['key'], 'label' => $info['label']],
                array_filter($providers, fn (array $info): bool => $info['connected'] || (int) ($providerCounts[$info['key']] ?? 0) > 0),
            )),
            'can' => [
                'create' => ResourcePermission::allows($user, 'posts', 'create'),
                'update' => ResourcePermission::allows($user, 'posts', 'update'),
                'delete' => ResourcePermission::allows($user, 'posts', 'delete'),
                'publish' => ResourcePermission::allows($user, 'posts', 'publish'),
            ],
        ]);
    }

    public function create(Request $request): Response
    {
        return $this->form($request, null);
    }

    public function edit(Request $request, Post $post): Response|RedirectResponse
    {
        if (! $post->isContentEditable()) {
            Inertia::flash('toast', ['type' => 'error', 'message' => 'Bài viết đang được đăng, chưa thể sửa.']);

            return to_route('posts.index');
        }

        return $this->form($request, $post);
    }

    public function store(SavePostRequest $request): RedirectResponse
    {
        $post = $this->persist(new Post, $request);

        return $this->afterSave($request, $post);
    }

    public function update(SavePostRequest $request, Post $post): RedirectResponse
    {
        $post = $this->persist($post, $request);

        return $this->afterSave($request, $post);
    }

    public function destroy(Post $post): RedirectResponse
    {
        if ($post->status === Post::STATUS_PUBLISHING) {
            Inertia::flash('toast', ['type' => 'error', 'message' => 'Bài viết đang được đăng, chưa thể xoá.']);

            return back();
        }

        $post->delete();
        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đã xoá bài viết.']);

        return back();
    }

    public function destroyMany(Request $request): RedirectResponse
    {
        $ids = $request->validate(['ids' => ['required', 'array', 'min:1', 'max:100'], 'ids.*' => ['integer']])['ids'];

        // * A post being published is skipped, never interrupted.
        $count = Post::query()->whereIn('id', $ids)->where('status', '!=', Post::STATUS_PUBLISHING)->get()->each->delete()->count();
        Inertia::flash('toast', ['type' => 'success', 'message' => "Đã xoá {$count} bài viết."]);

        return back();
    }

    /**
     * * "Nhân bản": a new draft with the same content. Title gets a suffix, the schedule is dropped, media and target platforms are
     * * copied as `pending`. The original is untouched and nothing is sent.
     */
    public function duplicate(Post $post): RedirectResponse
    {
        $copy = DB::transaction(function () use ($post): Post {
            $copy = new Post([
                // * Capped to the column limit (255) so a long title never makes the copy fail.
                'title' => $post->title === null ? null : Str::limit($post->title, 255 - mb_strlen(self::COPY_SUFFIX), '').self::COPY_SUFFIX,
                'body' => $post->body,
                'media' => $post->media,
                'scheduled_at' => null,
            ]);
            $copy->forceFill(['status' => Post::STATUS_DRAFT])->save();

            foreach ($post->targets()->get(['provider', 'social_group_id', 'audience']) as $target) {
                $copy->targets()->create(['provider' => $target->provider, 'social_group_id' => $target->social_group_id, 'audience' => $target->audience]);
            }

            return $copy;
        });

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đã tạo bản nháp từ bài viết.']);

        return to_route('posts.edit', $copy);
    }

    /** * "Đăng ngay" for a scheduled or missed post. The job claims it atomically, so a double click sends once. */
    public function publish(Post $post): RedirectResponse
    {
        $moved = Post::query()
            ->whereKey($post->id)
            ->whereIn('status', [Post::STATUS_SCHEDULED, Post::STATUS_MISSED])
            ->whereHas('targets', fn ($query) => $query->where('status', PostTarget::STATUS_PENDING))
            ->update(['status' => Post::STATUS_SCHEDULED, 'scheduled_at' => now(), 'updated_at' => now()]);

        if ($moved === 0) {
            Inertia::flash('toast', ['type' => 'info', 'message' => 'Bài viết này không còn ở trạng thái chờ đăng.']);

            return back();
        }

        PublishPostJob::dispatchAfterResponse($post->id);
        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đang đăng bài viết.']);

        return back();
    }

    /** * "Hẹn lại" for a scheduled or missed post. */
    public function reschedule(Request $request, Post $post): RedirectResponse
    {
        $validated = $request->validate([
            'scheduled_date' => ['required', 'date_format:Y-m-d'],
            'scheduled_time' => ['required', 'date_format:H:i'],
        ]);
        $scheduledAt = CarbonImmutable::createFromFormat('Y-m-d H:i', "{$validated['scheduled_date']} {$validated['scheduled_time']}", config('cms.personal_timezone'))->utc();

        if ($scheduledAt->lessThanOrEqualTo(now())) {
            return back()->withErrors(['scheduled_date' => 'Thời gian hẹn phải ở tương lai.']);
        }

        $moved = Post::query()
            ->whereKey($post->id)
            ->whereIn('status', [Post::STATUS_SCHEDULED, Post::STATUS_MISSED])
            ->update(['status' => Post::STATUS_SCHEDULED, 'scheduled_at' => $scheduledAt, 'updated_at' => now()]);

        Inertia::flash('toast', $moved === 0
            ? ['type' => 'info', 'message' => 'Bài viết này không còn ở trạng thái chờ đăng.']
            : ['type' => 'success', 'message' => 'Đã hẹn lại giờ đăng.']);

        return back();
    }

    /**
     * * "Dừng đăng" for a post that is being published: every target still waiting or running is marked failed so nothing more is sent.
     * * A running target that has already gone out keeps its real result (see PostPublishingService::publishClaimedTarget).
     */
    public function cancel(Post $post): RedirectResponse
    {
        if ($post->status !== Post::STATUS_PUBLISHING) {
            Inertia::flash('toast', ['type' => 'info', 'message' => 'Bài viết này không còn đang đăng.']);

            return back();
        }

        PostTarget::query()
            ->where('post_id', $post->id)
            ->whereIn('status', [PostTarget::STATUS_PENDING, PostTarget::STATUS_PUBLISHING])
            ->update(['status' => PostTarget::STATUS_FAILED, 'error' => 'Đã dừng thủ công, bài chưa được đăng.', 'updated_at' => now()]);
        $post->refreshStatus();

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đã dừng đăng bài viết.']);

        return back();
    }

    /** * "Bỏ" for a missed post: back to a draft without a schedule. */
    public function dismiss(Post $post): RedirectResponse
    {
        $moved = Post::query()
            ->whereKey($post->id)
            ->where('status', Post::STATUS_MISSED)
            ->update(['status' => Post::STATUS_DRAFT, 'scheduled_at' => null, 'updated_at' => now()]);

        Inertia::flash('toast', $moved === 0
            ? ['type' => 'info', 'message' => 'Bài viết này không còn ở trạng thái lỡ lịch.']
            : ['type' => 'success', 'message' => 'Đã chuyển bài viết về nháp.']);

        return back();
    }

    /**
     * * Manual "Thử lại"/"Đăng lại" of one platform. A `unknown` target may already be live, so it needs `confirm_maybe_published`.
     * * One atomic UPDATE claims the target; a second click while it runs claims nothing.
     */
    public function retry(Request $request, PostTarget $target, PostPublishingService $service): RedirectResponse
    {
        $validated = $request->validate(['confirm_maybe_published' => ['nullable', 'boolean']]);

        if ($target->status === PostTarget::STATUS_UNKNOWN && ! ($validated['confirm_maybe_published'] ?? false)) {
            Inertia::flash('toast', ['type' => 'error', 'message' => 'Cần xác nhận "Có thể đã đăng" trước khi đăng lại.']);

            return back();
        }

        if (! $service->claimTarget($target, PostTarget::RETRYABLE_STATUSES)) {
            Inertia::flash('toast', ['type' => 'info', 'message' => 'Nền tảng này đang được đăng hoặc đã đăng xong.']);

            return back();
        }

        Post::query()->whereKey($target->post_id)->whereIn('status', [Post::STATUS_FAILED, Post::STATUS_PARTIAL])->update(['status' => Post::STATUS_PUBLISHING, 'updated_at' => now()]);
        PublishPostJob::dispatchAfterResponse($target->post_id, $target->id);
        Inertia::flash('toast', ['type' => 'success', 'message' => 'Đang đăng lại.']);

        return back();
    }

    private function persist(Post $post, SavePostRequest $request): Post
    {
        $action = $request->input('action');

        // * Content-only save: the text, title and media change; status, schedule and targets are untouched.
        if ($action === SavePostRequest::ACTION_SAVE) {
            $post->fill([
                'title' => filled($request->input('title')) ? $request->input('title') : null,
                'body' => $request->input('body'),
                'media' => $request->input('media') ?: null,
            ])->save();

            return $post;
        }

        $scheduledAt = $action === SavePostRequest::ACTION_PUBLISH_NOW ? CarbonImmutable::now() : $request->scheduledAt();

        return DB::transaction(function () use ($post, $request, $action, $scheduledAt): Post {
            $post->fill([
                'title' => filled($request->input('title')) ? $request->input('title') : null,
                'body' => $request->input('body'),
                'media' => $request->input('media') ?: null,
                'scheduled_at' => $scheduledAt,
            ]);
            // * `status` is system-owned (not fillable): it follows the action here and the publishing service afterwards.
            $post->forceFill(['status' => $action === SavePostRequest::ACTION_DRAFT ? Post::STATUS_DRAFT : Post::STATUS_SCHEDULED])->save();

            // * Platforms are chosen when the post is created; later saves keep them (a post saved without any can still get them once).
            if ($post->wasRecentlyCreated === false && $post->targets()->exists()) {
                return $post;
            }

            $providers = array_values((array) ($request->input('targets') ?? []));
            $groupIds = $request->groupIds();
            $keep = [];

            // * Only editable posts reach here, so every target is still `pending` and safe to add or drop.
            foreach ($providers as $provider) {
                $keep[] = $post->targets()->updateOrCreate(['provider' => $provider, 'social_group_id' => null], ['audience' => $request->audienceFor($provider)])->id;
            }

            foreach ($groupIds as $provider => $ids) {
                foreach ($ids as $groupId) {
                    $keep[] = $post->targets()->updateOrCreate(['provider' => $provider, 'social_group_id' => $groupId], ['audience' => $request->audienceFor($provider)])->id;
                }
            }

            $post->targets()->whereNotIn('id', $keep)->delete();

            return $post;
        });
    }

    private function afterSave(SavePostRequest $request, Post $post): RedirectResponse
    {
        if ($request->input('action') === SavePostRequest::ACTION_PUBLISH_NOW) {
            PublishPostJob::dispatchAfterResponse($post->id);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => match ($request->input('action')) {
            SavePostRequest::ACTION_PUBLISH_NOW => 'Đang đăng bài viết.',
            SavePostRequest::ACTION_SCHEDULE => 'Đã hẹn giờ đăng bài viết.',
            SavePostRequest::ACTION_SAVE => 'Đã lưu nội dung bài viết.',
            default => 'Đã lưu nháp.',
        }]);

        return to_route('posts.index');
    }

    private function form(Request $request, ?Post $post): Response
    {
        $zone = config('cms.personal_timezone');
        $local = $post?->scheduled_at === null ? null : CarbonImmutable::instance($post->scheduled_at)->setTimezone($zone);

        return Inertia::render('posts/form', [
            'post' => $post === null ? null : [
                'id' => $post->id,
                'title' => $post->title,
                'body' => $post->body,
                'media' => $post->media ?? [],
                'targets' => $post->targets()->whereNull('social_group_id')->pluck('provider')->all(),
                'audiences' => $post->targets()->whereNull('social_group_id')->pluck('audience', 'provider')->all(),
                'groups' => $post->targets()->whereNotNull('social_group_id')->get(['provider', 'social_group_id'])
                    ->groupBy('provider')->map(fn ($rows) => $rows->pluck('social_group_id')->all())->all(),
                'scheduled_date' => $local?->format('Y-m-d'),
                'scheduled_time' => $local?->format('H:i'),
                'status' => $post->status,
            ],
            // * Where the post already went (or is going): shown on the edit page of a post that has targets.
            'deliveries' => $post === null ? [] : $this->presentTargets($post->targets()->with('group')->get(), $this->providers->all()),
            'providers' => array_values($this->providers->all()),
            // * Groups the account left are not offered for new posts, except those this post already targets.
            'socialGroups' => SocialGroup::query()
                ->where(fn ($query) => $query->whereNull('left_at')->when($post !== null, fn ($inner) => $inner->orWhereIn('id', $post->targets()->whereNotNull('social_group_id')->select('social_group_id'))))
                ->orderBy('name')->get(['id', 'provider', 'name', 'image_url'])->map(fn (SocialGroup $group): array => [
                    'id' => $group->id,
                    'provider' => $group->provider,
                    'name' => $group->name,
                    'image_url' => $group->image_url,
                ])->all(),
            'timezone' => ['name' => $zone, 'label' => 'GMT'.CarbonImmutable::now($zone)->format('P')],
            'maxBodyLength' => Post::MAX_BODY_LENGTH,
            'canPublish' => ResourcePermission::allows($request->user(), 'posts', 'publish'),
        ]);
    }

    /**
     * @param  array<string, ProviderInfo>  $providers
     * @return array<string, mixed>
     */
    private function present(Post $post, array $providers): array
    {
        $publishedAt = $post->targets->pluck('published_at')->filter()->max();

        return [
            'id' => $post->id,
            'title' => $post->title,
            'excerpt' => Str::limit(preg_replace('/\s+/u', ' ', $post->body) ?? $post->body, self::EXCERPT_LENGTH),
            'status' => $post->status,
            'status_label' => Post::STATUS_LIST[$post->status],
            'scheduled_at' => $post->scheduled_at?->toIso8601String(),
            'published_at' => $publishedAt?->toIso8601String(),
            'editable' => $post->isContentEditable(),
            // * "Đăng ngay"/"Hẹn lại" apply while something is still waiting to be sent.
            'cancellable' => $post->status === Post::STATUS_PUBLISHING,
            'awaiting' => in_array($post->status, [Post::STATUS_SCHEDULED, Post::STATUS_MISSED], true)
                && $post->targets->contains(fn (PostTarget $target): bool => $target->status === PostTarget::STATUS_PENDING),
            'targets' => $this->presentTargets($post->targets, $providers),
        ];
    }

    /**
     * @param  Collection<int, PostTarget>  $targets
     * @param  array<string, ProviderInfo>  $providers
     * @return list<array<string, mixed>>
     */
    private function presentTargets(Collection $targets, array $providers): array
    {
        return $targets->map(fn (PostTarget $target): array => [
            'id' => $target->id,
            'provider' => $target->provider,
            'label' => $providers[$target->provider]['label'] ?? $target->provider,
            'group' => $target->group?->name,
            'group_url' => $target->group?->url,
            'letter' => $providers[$target->provider]['letter'] ?? '?',
            'color' => $providers[$target->provider]['color'] ?? '#64748b',
            'status' => $target->status,
            'status_label' => PostTarget::STATUS_LIST[$target->status],
            'error' => $target->error,
            'external_url' => $target->external_url,
            'published_at' => $target->published_at?->toIso8601String(),
            'can_retry' => $target->canRetry(),
        ])->values()->all();
    }
}
