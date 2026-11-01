import { usePage } from '@inertiajs/react';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type LocaleOption = {
    code: string;
    iso_code: string;
    display_name: string;
    is_default: boolean;
};

/** * Global, persisted content locale for translatable fields; sent as `?locale=` to the `/items` API. */
const LocaleContext = createContext<[string, (locale: string) => void]>([
    'vi',
    () => {},
]);

export function LocaleProvider({ children }: { children: ReactNode }) {
    const { locales } = usePage<{ locales?: LocaleOption[] }>().props;
    const defaultCode =
        locales?.find((entry) => entry.is_default)?.code ??
        locales?.[0]?.code ??
        'vi';
    const [locale, setLocale] = useState(
        () => localStorage.getItem('locale') ?? defaultCode,
    );

    useEffect(() => {
        localStorage.setItem('locale', locale);
    }, [locale]);

    return (
        <LocaleContext.Provider value={[locale, setLocale]}>
            {children}
        </LocaleContext.Provider>
    );
}

export function useLocale() {
    return useContext(LocaleContext);
}
