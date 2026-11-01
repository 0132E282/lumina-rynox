import { createContext, useContext } from 'react';

export type SplitViewContextValue = {
    open: (url: string) => void;
    /** * Lets `Section`/`Sidebar` force-stack while the preview is open. */
    isActive: boolean;
};

export const SplitViewContext = createContext<
    SplitViewContextValue | undefined
>(undefined);

export function useSplitView(): SplitViewContextValue | undefined {
    return useContext(SplitViewContext);
}
