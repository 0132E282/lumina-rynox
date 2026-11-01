<?php

declare(strict_types=1);

namespace App\Concerns;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Pagination\LengthAwarePaginator as LengthAwarePaginatorImpl;
use Illuminate\Support\Facades\Cache;

/**
 * * Opt-in read cache for `/items/{collection}`, keyed by model + request params, for `cacheTtl()` seconds.
 * ! No invalidation on write — only use on read-heavy collections that tolerate stale results.
 */
trait Cacheable
{
    public function cacheTtl(): int
    {
        return 60;
    }

    /**
     * ! Cache items as `toArray()`: stores refuse to unserialize Eloquent objects (`cache.serializable_classes`)
     * ! and would return `__PHP_Incomplete_Class`.
     */
    public function rememberQuery(array $params, callable $resolver): LengthAwarePaginator|Collection
    {
        $cacheKey = 'query-cache:'.static::class.':'.md5(json_encode($params));

        $cached = Cache::remember($cacheKey, $this->cacheTtl(), function () use ($resolver) {
            $result = $resolver();

            if ($result instanceof LengthAwarePaginator) {
                return [
                    'paginated' => true,
                    'items' => collect($result->items())->toArray(),
                    'total' => $result->total(),
                    'per_page' => $result->perPage(),
                    'current_page' => $result->currentPage(),
                ];
            }

            return ['paginated' => false, 'items' => $result->toArray()];
        });

        if ($cached['paginated']) {
            return new LengthAwarePaginatorImpl(collect($cached['items']), $cached['total'], $cached['per_page'], $cached['current_page']);
        }

        return new Collection($cached['items']);
    }
}
