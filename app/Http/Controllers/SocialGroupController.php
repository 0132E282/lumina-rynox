<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\SocialGroup;
use App\Services\Posting\SocialGroupException;
use App\Services\Posting\SocialGroupSync;
use App\Support\ResourcePermission;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** * Groups the personal Facebook / LinkedIn account joined: saved list (`integrations.view`) and manual sync (`integrations.update` + tight throttle, route). */
class SocialGroupController extends Controller
{
    private const PER_PAGE = 20;

    public function __construct(private readonly SocialGroupSync $sync) {}

    /** * Management table of every saved group (`integrations.view`); the sync buttons need `integrations.update`. */
    public function manage(Request $request): Response
    {
        $requested = $request->query('provider');
        $provider = is_string($requested) && in_array($requested, SocialGroupSync::PROVIDERS, true) ? $requested : null;

        $requestedState = $request->query('state');
        $state = in_array($requestedState, ['active', 'left'], true) ? $requestedState : null;

        $search = trim((string) $request->query('q', ''));
        $search = mb_substr($search, 0, 100);

        $groups = SocialGroup::query()
            ->whereIn('provider', $provider === null ? SocialGroupSync::PROVIDERS : [$provider])
            ->when($state === 'active', fn ($query) => $query->whereNull('left_at'))
            ->when($state === 'left', fn ($query) => $query->whereNotNull('left_at'))
            ->when($search !== '', function ($query) use ($search) {
                // * `!` is the escape character, declared in SQL: `\` as an escape is MySQL-only, so `%` and `_` stay plain characters everywhere.
                $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%';

                $query->where(fn ($inner) => $inner->whereRaw("name like ? escape '!'", [$like])->orWhere('external_id', $search));
            })
            ->orderBy('provider')
            ->orderBy('name')
            ->orderBy('id')
            ->paginate(self::PER_PAGE)
            ->through(fn (SocialGroup $group): array => [
                'id' => $group->id,
                'provider' => $group->provider,
                'external_id' => $group->external_id,
                'name' => $group->name,
                'url' => $group->url,
                'image_url' => $group->image_url,
                'synced_at' => $group->synced_at->toIso8601String(),
                'left_at' => $group->left_at?->toIso8601String(),
            ])
            ->toArray();

        $counts = SocialGroup::query()->whereIn('provider', SocialGroupSync::PROVIDERS)->selectRaw('provider, count(*) as total')->groupBy('provider')->pluck('total', 'provider');

        return Inertia::render('social-groups/index', [
            'groups' => $groups,
            'filters' => ['provider' => $provider, 'q' => $search, 'state' => $state],
            'counts' => ['all' => (int) $counts->sum(), ...array_map(fn (string $key): int => (int) ($counts[$key] ?? 0), array_combine(SocialGroupSync::PROVIDERS, SocialGroupSync::PROVIDERS))],
            'providers' => array_map(
                fn (string $provider): array => [
                    'key' => $provider,
                    'name' => (string) config("integrations.providers.{$provider}.name"),
                    'letter' => (string) config("integrations.providers.{$provider}.letter", '?'),
                    'color' => (string) config("integrations.providers.{$provider}.color", '#64748b'),
                ],
                SocialGroupSync::PROVIDERS,
            ),
            'canSync' => ResourcePermission::allows($request->user(), 'integrations', 'update'),
        ]);
    }

    public function index(string $provider): JsonResponse
    {
        $this->guard($provider);

        return $this->groups($provider);
    }

    public function sync(string $provider): JsonResponse
    {
        $this->guard($provider);

        try {
            $result = $this->sync->sync($provider);
        } catch (SocialGroupException $exception) {
            // * The messages are fixed Vietnamese texts from SocialGroupSync: they hold no path, no script output.
            return response()->json(['message' => $exception->getMessage()], 502)->header('Cache-Control', 'no-store');
        }

        return $this->groups($provider, $result);
    }

    private function guard(string $provider): void
    {
        in_array($provider, SocialGroupSync::PROVIDERS, true) || abort(404);
    }

    /** @param  array<string, int>  $extra */
    private function groups(string $provider, array $extra = []): JsonResponse
    {
        $groups = SocialGroup::query()
            ->where('provider', $provider)
            ->orderBy('name')
            ->get()
            ->map(fn (SocialGroup $group): array => [
                'id' => $group->id,
                'name' => $group->name,
                'url' => $group->url,
                'image_url' => $group->image_url,
                'synced_at' => $group->synced_at->toIso8601String(),
                'left_at' => $group->left_at?->toIso8601String(),
            ])
            ->all();

        return response()->json(['groups' => $groups, ...$extra])->header('Cache-Control', 'no-store');
    }
}
