import { useEffect, useState } from 'react';

/** * Returns `value` once it stops changing for `delay` ms (e.g. search input → fetch). */
export function useDebounce<T>(value: T, delay = 300): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebounced(value), delay);

        return () => window.clearTimeout(timer);
    }, [value, delay]);

    return debounced;
}
