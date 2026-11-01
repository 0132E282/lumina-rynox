import '@tanstack/react-table';

declare module '@tanstack/react-table' {
    // * TData/TValue are required by the library's generic signature but unused here.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData, TValue> {
        label?: string;
        /** * Filter dialog renders a Select from this value→label list. */
        filterOptions?: { value: string; label: string }[];
        /** * Filter dialog loads options from `/items/{collection}/options/{field}`. */
        filterRelation?: { collection: string; field?: string };
        /** * Filter dialog renders a native date(time) picker. */
        filterInputType?: 'date' | 'datetime-local';
        /** * Filter dialog renders a multi-select (`_in`/`_nin`) instead of a single-value select. */
        filterMultiple?: boolean;
    }
}
