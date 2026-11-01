import { createContext, useContext } from 'react';

/** * Set by `FormLayout`; `SelectField` uses it to resolve `/items/{collection}/options/{field}`. */
export const FormCollectionContext = createContext<string | undefined>(
    undefined,
);

export function useFormCollection(): string | undefined {
    return useContext(FormCollectionContext);
}

/** * Set by `FormLayout` so descendants (e.g. `FrontendUrl`) don't need prop drilling. */
export const FormRecordIdContext = createContext<string | number | undefined>(
    undefined,
);

export function useFormRecordId(): string | number | undefined {
    return useContext(FormRecordIdContext);
}
