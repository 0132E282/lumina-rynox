import { Link, usePage } from '@inertiajs/react';
import { X } from 'lucide-react';
import * as React from 'react';

import { activeNavUrl, matchesNavUrl } from '@/components/nav-main';
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from '@/components/ui/sidebar';
import { useChildSidebar } from '@/contexts/child-sidebar-context';

/** * Column of pages next to the collapsed icon rail. It is part of the layout (it pushes the page), not a layer over it. */
export function ChildSidebarPanel() {
    const [group, setGroup] = useChildSidebar();
    const { state, isMobile } = useSidebar();
    const { url } = usePage();
    const currentPath = new URL(url, 'http://localhost').pathname;
    const visible = group !== null && state === 'collapsed' && !isMobile;

    // * Once the full sidebar is open (or on mobile) the group unfolds in the list itself, so the column goes away.
    React.useEffect(() => {
        if (group !== null && !visible) {
            setGroup(null);
        }
    }, [group, visible, setGroup]);

    // * Landing on a page outside the open group closes the column (checked on navigation only, so opening a group from another page can still travel to its first page).
    const groupRef = React.useRef(group);

    groupRef.current = group;

    React.useEffect(() => {
        const open = groupRef.current;

        if (
            open !== null &&
            !open.items.some((item) => matchesNavUrl(currentPath, item.url))
        ) {
            setGroup(null);
        }
    }, [currentPath, setGroup]);

    if (!visible) {
        return null;
    }

    const activeUrl = activeNavUrl(currentPath, group.items);

    return (
        <aside
            aria-label={group.title}
            className="sticky top-0 hidden h-svh w-56 shrink-0 flex-col gap-1 border-r bg-sidebar p-2 text-sidebar-foreground md:flex"
        >
            <div className="flex items-center justify-between pl-3">
                <h2 className="truncate text-base font-semibold">
                    {group.title}
                </h2>
                <button
                    type="button"
                    aria-label="Đóng"
                    onClick={() => setGroup(null)}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
                >
                    <X aria-hidden="true" className="size-4" />
                </button>
            </div>
            <SidebarMenu>
                {group.items.map((item) => (
                    <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                            asChild
                            isActive={item.url === activeUrl}
                            className="h-9 px-3 py-0"
                        >
                            <Link
                                href={item.url}
                                aria-current={
                                    item.url === activeUrl ? 'page' : undefined
                                }
                            >
                                {item.icon && <item.icon />}
                                <span>{item.title}</span>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                ))}
            </SidebarMenu>
        </aside>
    );
}
