<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\ResourcePermission;
use App\Support\ResourceResolver;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * * Per-resource permission for the generic items API and pages. Opt-in: only models declaring `PERMISSION_RESOURCE`
 * * are guarded; every other resource keeps its current behaviour. Explicit form: `AuthorizeResource::class.':tasks,view'`.
 * ! `api/items` is session-only (`auth`). There, a model without `PERMISSION_RESOURCE` is fail-closed: system admins only.
 */
class AuthorizeResource
{
    private const ABILITY_BY_ROUTE = [
        'items.index' => 'view',
        'items.show' => 'view',
        'items.source' => 'view',
        'items.options' => 'view',
        'items.export' => 'view',
        'items.dashboards' => 'view',
        'items.frontend-url' => 'view',
        'items.index-status' => 'view',
        'items.store' => 'create',
        'items.import' => 'create',
        'items.update' => 'update',
        'items.destroy' => 'delete',
        'items.restore' => 'delete',
        'items.force-destroy' => 'delete',
    ];

    public function handle(Request $request, Closure $next, ?string $resource = null, ?string $ability = null): Response
    {
        if ($resource === null) {
            [$resource, $ability] = $this->fromRoute($request);
        }

        if ($resource !== null && ! ResourcePermission::allows($request->user(), $resource, (string) $ability)) {
            abort($request->user() === null ? 401 : 403);
        }

        return $next($request);
    }

    /** @return array{0: ?string, 1: ?string} */
    private function fromRoute(Request $request): array
    {
        $route = $request->route();
        $segment = $route?->parameter('resource') ?? $route?->parameter('collection');
        $modelClass = is_string($segment) ? ResourceResolver::resolve($segment) : null;

        if ($modelClass === null) {
            return [null, null];
        }

        $name = preg_replace('/^api\./', '', (string) $route->getName());

        if (! defined("{$modelClass}::PERMISSION_RESOURCE")) {
            // * Only `api/items` is fail-closed; `manage` is held by system admins alone. Web routes keep their behaviour.
            return str_starts_with((string) $route->getName(), 'api.') ? [$segment, 'manage'] : [null, null];
        }
        $ability = $name === 'view.page'
            ? ($route->parameter('slug') === 'create' ? 'create' : 'view')
            // * Unknown routes fall back to an ability only system admins hold.
            : (self::ABILITY_BY_ROUTE[$name] ?? 'manage');

        return [constant("{$modelClass}::PERMISSION_RESOURCE"), $ability];
    }
}
