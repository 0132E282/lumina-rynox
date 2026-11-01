import { Link, router, usePage } from '@inertiajs/react';
import { ChevronRight } from 'lucide-react';
import type * as React from 'react';

import { activeNavUrl } from '@/components/nav-main';
import type { NavMainItem } from '@/components/nav-main';
import { useChildSidebar } from '@/contexts/child-sidebar-context';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    useSidebar,
} from '@/components/ui/sidebar';

/** * A secondary menu: one entry that holds several pages. Expanded it starts open in place (and can be folded); collapsed its icon opens the sidebar. */
export function NavSubMenu({
    groupKey,
    title,
    icon: Icon,
    items,
}: {
    groupKey: string;
    title: string;
    icon?: React.ComponentType<{ className?: string }>;
    items: NavMainItem[];
}) {
    const { state, isMobile } = useSidebar();
    const [childGroup, setChildGroup] = useChildSidebar();
    const { url: currentUrl } = usePage();
    const currentPath = new URL(currentUrl, 'http://localhost').pathname;
    const activeUrl = activeNavUrl(currentPath, items);
    const isActive = activeUrl !== undefined;

    // * Collapsed: the icon opens the child sidebar (a column in the layout beside the rail); a second click closes it.
    if (state === 'collapsed' && !isMobile) {
        const childOpen = childGroup?.key === groupKey;

        return (
            <SidebarGroup className="px-2 py-0">
                <SidebarGroupContent>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                tooltip={title}
                                isActive={isActive || childOpen}
                                aria-expanded={childOpen}
                                onClick={() => {
                                    if (childOpen) {
                                        setChildGroup(null);

                                        return;
                                    }

                                    setChildGroup({
                                        key: groupKey,
                                        title,
                                        items,
                                    });

                                    // * Opening a group lands on its first page; a group already showing the current page stays put.
                                    if (!isActive && items[0]) {
                                        router.visit(items[0].url);
                                    }
                                }}
                                className="h-9 px-3 py-0"
                            >
                                {Icon && <Icon />}
                                <span>{title}</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>
        );
    }

    return (
        <SidebarGroup className="px-2 py-0">
            <SidebarGroupContent>
                <SidebarMenu>
                    <Collapsible
                        asChild
                        defaultOpen
                        className="group/collapsible"
                    >
                        <SidebarMenuItem>
                            <CollapsibleTrigger asChild>
                                <SidebarMenuButton
                                    tooltip={title}
                                    isActive={isActive}
                                    className="h-9 px-3 py-0"
                                >
                                    {Icon && <Icon />}
                                    <span>{title}</span>
                                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 motion-reduce:transition-none" />
                                </SidebarMenuButton>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <SidebarMenuSub>
                                    {items.map((item) => (
                                        <SidebarMenuSubItem key={item.url}>
                                            <SidebarMenuSubButton
                                                asChild
                                                isActive={
                                                    item.url === activeUrl
                                                }
                                            >
                                                <Link href={item.url}>
                                                    {item.icon && <item.icon />}
                                                    <span>{item.title}</span>
                                                </Link>
                                            </SidebarMenuSubButton>
                                        </SidebarMenuSubItem>
                                    ))}
                                </SidebarMenuSub>
                            </CollapsibleContent>
                        </SidebarMenuItem>
                    </Collapsible>
                </SidebarMenu>
            </SidebarGroupContent>
        </SidebarGroup>
    );
}
