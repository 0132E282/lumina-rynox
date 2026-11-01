import { createContext, useContext } from 'react';

/** * Lets a page (split-view preview) hide the sidebar fully instead of collapsing to the icon rail. */
export const SidebarFullyHiddenContext = createContext<
    [boolean, (hidden: boolean) => void]
>([false, () => {}]);

export function useSidebarFullyHidden() {
    return useContext(SidebarFullyHiddenContext);
}
