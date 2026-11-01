import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { NavMainItem } from '@/components/nav-main';

export type ChildSidebarGroup = {
    key: string;
    title: string;
    items: NavMainItem[];
};

type ChildSidebarState = [
    group: ChildSidebarGroup | null,
    setGroup: Dispatch<SetStateAction<ChildSidebarGroup | null>>,
];

/** * The group whose pages fill the child sidebar (the column beside the icon rail), shared by the rail and the layout. */
export const ChildSidebarContext = createContext<ChildSidebarState | null>(
    null,
);

export function useChildSidebar(): ChildSidebarState {
    return useContext(ChildSidebarContext) ?? [null, () => undefined];
}
