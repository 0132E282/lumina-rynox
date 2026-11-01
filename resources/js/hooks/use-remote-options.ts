import { useEffect, useRef, useState } from 'react';
import type { InputSelectOption } from '@/components/ui/input-select';
import { useLocale } from '@/contexts/locale-context';
import { useDebounce } from '@/hooks/use-debounce';
import { api } from '@/lib/api';

type RemoteOptionEntry =
    string | { value: string; label?: string; children?: RemoteOptionEntry[] };

export function normalizeRemoteOptions(
    entries: RemoteOptionEntry[],
): InputSelectOption[] {
    return entries.map((entry) =>
        typeof entry === 'string'
            ? { value: entry, label: entry }
            : {
                  value: entry.value,
                  label: entry.label ?? entry.value,
                  children: entry.children
                      ? normalizeRemoteOptions(entry.children)
                      : undefined,
              },
    );
}

const PAGE_SIZE = 50;

/** * Searched, paginated `/items/{collection}/options/{field}` for SelectField and the filter dialog; `source` undefined disables fetching. */
export function useRemoteOptions(
    source: { collection: string; field: string } | undefined,
) {
    const [locale] = useLocale();
    const [options, setOptions] = useState<InputSelectOption[]>([]);
    const [searchInput, setSearchInput] = useState('');
    const search = useDebounce(searchInput, 300);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const requestIdRef = useRef(0);

    const fetchPage = (pageNum: number, term: string, append: boolean) => {
        if (!source) {
            return;
        }

        const requestId = ++requestIdRef.current;

        if (append) {
            setLoadingMore(true);
        }

        api.get<{ data: RemoteOptionEntry[] }>(
            window.route('items.source', {
                resource: source.collection,
                field: source.field,
                locale,
                search: term || undefined,
                page: pageNum,
                limit: PAGE_SIZE,
            }),
        ).then((response) => {
            if (requestId !== requestIdRef.current) {
                return;
            }

            const normalized = normalizeRemoteOptions(response.data.data);

            setOptions((current) =>
                append ? [...current, ...normalized] : normalized,
            );
            setHasMore(normalized.length >= PAGE_SIZE);
            setLoadingMore(false);
        });
    };

    // * Back to page 1 when the source or the debounced term changes.
    useEffect(() => {
        if (!source) {
            return;
        }

        // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local pagination alongside the fetch this same effect triggers, not a re-render loop
        setPage(1);
        fetchPage(1, search, false);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `fetchPage` closes over these same deps; listing it too would just re-declare them
    }, [source?.collection, source?.field, locale, search]);

    const loadMore = () => {
        if (loadingMore || !hasMore) {
            return;
        }

        const nextPage = page + 1;

        setPage(nextPage);
        fetchPage(nextPage, search, true);
    };

    return {
        options,
        onSearchChange: setSearchInput,
        onLoadMore: loadMore,
        loading: loadingMore,
    };
}
