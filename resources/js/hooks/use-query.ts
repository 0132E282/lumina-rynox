import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type QueryState<T> = {
    data: T | undefined;
    loading: boolean;
    error: unknown;
};

/** * Fetches on mount and when params change; the URL comes from `route(name, params)`, e.g. `useQuery('items.index', { resource: 'orders' })`. */
export function useQuery<T>(
    name: string | null,
    params?: Record<string, unknown>,
) {
    const [state, setState] = useState<QueryState<T>>({
        data: undefined,
        loading: !!name,
        error: null,
    });
    const [refetchToken, setRefetchToken] = useState(0);
    const paramsKey = JSON.stringify(params ?? {});

    useEffect(() => {
        let cancelled = false;

        if (!name) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setState({ data: undefined, loading: false, error: null });

            return () => {
                cancelled = true;
            };
        }

        setState((current) => ({ ...current, loading: true, error: null }));

        const url = window.route(name, params);

        api.get<T>(url)
            .then((response) => {
                if (!cancelled) {
                    setState({
                        data: response.data,
                        loading: false,
                        error: null,
                    });
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setState({ data: undefined, loading: false, error });
                }
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, paramsKey, refetchToken]);

    const refetch = () => setRefetchToken((token) => token + 1);

    return { ...state, refetch };
}
