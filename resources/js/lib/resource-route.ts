/** * Collection pages share one route, so create/edit URLs derive from the collection name. */
export function resourceRoute(
    collection: string,
    slug?: string | number,
): string {
    return window.route('view.page', { collection, slug });
}

/** * First URL segment: `/orders/5` → `orders`. */
export function currentCollection(url: string): string {
    return url.split('?')[0].split('/').filter(Boolean)[0] ?? '';
}

/** * `/items/{collection}` admin API path. */
export function itemsRoute(collection: string, path = ''): string {
    return `/items/${collection}${path}`;
}
