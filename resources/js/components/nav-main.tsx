import { Link, usePage } from '@inertiajs/react';
import type * as React from 'react';

import {
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';

export type NavMainItem = {
    title: string;
    url: string;
    icon?: React.ComponentType<{ className?: string }>;
    badge?: number;
};

// * Strip Vietnamese diacritics so "he thong" matches "Hệ thống".
function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase();
}

export function filterNavItems(
    items: NavMainItem[],
    query: string,
): NavMainItem[] {
    const normalized = normalizeText(query.trim());

    if (!normalized) {
        return items;
    }

    return items.filter((item) =>
        normalizeText(item.title).includes(normalized),
    );
}

export function matchesNavUrl(currentPath: string, url: string): boolean {
    return (
        url !== '#' &&
        (currentPath === url ||
            (url !== '/' && currentPath.startsWith(`${url}/`)))
    );
}

/** * The one item that is "current": the longest matching url, so `/jobs` does not stay lit on `/jobs/sources`. */
export function activeNavUrl(
    currentPath: string,
    items: { url: string }[],
): string | undefined {
    return items
        .filter((item) => matchesNavUrl(currentPath, item.url))
        .sort((a, b) => b.url.length - a.url.length)[0]?.url;
}

export function NavMain({
    items,
    search,
}: {
    items: NavMainItem[];
    search?: string;
}) {
    const { url: currentUrl } = usePage();
    const currentPath = new URL(currentUrl, 'http://localhost').pathname;
    const isSearching = !!search?.trim();
    const filteredItems = isSearching
        ? filterNavItems(items, search ?? '')
        : items;
    const isEmpty = isSearching && filteredItems.length === 0;
    const activeUrl = activeNavUrl(currentPath, items);

    return (
        <SidebarGroup className="px-2 py-0">
            <SidebarGroupContent className="flex flex-col gap-2">
                <p
                    role="status"
                    className={
                        isEmpty
                            ? 'px-2 py-4 text-sm text-muted-foreground'
                            : 'sr-only'
                    }
                >
                    {isEmpty ? 'Không tìm thấy mục phù hợp.' : ''}
                </p>
                <SidebarMenu>
                    {filteredItems.map((item) => {
                        const isActive = item.url === activeUrl;

                        return (
                            <SidebarMenuItem key={item.url}>
                                <SidebarMenuButton
                                    className="h-9 px-3 py-0"
                                    tooltip={item.title}
                                    asChild
                                    isActive={isActive}
                                >
                                    <Link
                                        href={item.url}
                                        aria-current={
                                            isActive ? 'page' : undefined
                                        }
                                    >
                                        {item.icon && <item.icon />}
                                        <span>{item.title}</span>
                                    </Link>
                                </SidebarMenuButton>
                                {item.badge ? (
                                    <SidebarMenuBadge>
                                        {item.badge}
                                    </SidebarMenuBadge>
                                ) : null}
                            </SidebarMenuItem>
                        );
                    })}
                </SidebarMenu>
            </SidebarGroupContent>
        </SidebarGroup>
    );
}
