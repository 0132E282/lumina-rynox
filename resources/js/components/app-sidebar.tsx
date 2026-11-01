'use client';

import { usePage } from '@inertiajs/react';
import { Search, X } from 'lucide-react';
import * as React from 'react';

import { NavMain } from '@/components/nav-main';
import type { NavMainItem } from '@/components/nav-main';
import { NavSubMenu } from '@/components/nav-sub-menu';
import { NavUser } from '@/components/nav-user';
import { Input } from '@/components/ui/input';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarRail,
    SidebarTrigger,
    useSidebar,
} from '@/components/ui/sidebar';
import { useSidebarFullyHidden } from '@/contexts/sidebar-collapse-context';
import { ICON_MAP } from '@/lib/icon-map';
import type { NavigationConfig } from '@/lib/navigation';
import type { Auth } from '@/types';

/** * One sidebar: icons only when collapsed, the same icons with their names (and a search box) when expanded. */
export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { auth, setting, navigation } = usePage<{
        auth: Auth;
        setting?: { site_name?: string; logo_url?: string };
        navigation: NavigationConfig;
    }>().props;
    const [search, setSearch] = React.useState('');
    const [fullyHidden] = useSidebarFullyHidden();
    const {
        state,
        isMobile,
        openMobile,
        setOpen,
        setOpenMobile,
        toggleSidebar,
    } = useSidebar();
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const pendingFocusRef = React.useRef(false);
    const isSidebarVisible = isMobile ? openMobile : state === 'expanded';

    const focusSearch = () => {
        if (isSidebarVisible) {
            searchInputRef.current?.focus();

            return;
        }

        // * The search box only exists while expanded; focus it after the sidebar opens.
        pendingFocusRef.current = true;

        if (isMobile) {
            setOpenMobile(true);
        } else {
            setOpen(true);
        }
    };

    React.useEffect(() => {
        if (isSidebarVisible && pendingFocusRef.current) {
            pendingFocusRef.current = false;
            const frame = requestAnimationFrame(() =>
                searchInputRef.current?.focus(),
            );

            return () => cancelAnimationFrame(frame);
        }
    }, [isSidebarVisible]);

    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.key.toLowerCase() === 'k' &&
                (event.metaKey || event.ctrlKey)
            ) {
                event.preventDefault();
                focusSearch();
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => window.removeEventListener('keydown', handleKeyDown);
    });

    // * `icon` comes from PHP config as a lucide-react export name and is resolved to the component here.
    const toItem = (item: NavigationConfig['main'][number]['items'][number]) =>
        ({
            ...item,
            icon: item.icon ? ICON_MAP[item.icon] : undefined,
        }) satisfies NavMainItem;
    const items = React.useMemo(
        () => navigation.main.flatMap((group) => group.items.map(toItem)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [navigation.main],
    );
    // * Flat groups run together as one list; a `submenu` group breaks the list and folds into its own entry.
    const sections = React.useMemo(() => {
        const result: (
            | { kind: 'items'; items: NavMainItem[] }
            | {
                  kind: 'sub';
                  key: string;
                  title: string;
                  icon?: NavMainItem['icon'];
                  items: NavMainItem[];
              }
        )[] = [];

        for (const group of navigation.main) {
            if (group.submenu) {
                result.push({
                    kind: 'sub',
                    key: group.key,
                    title: group.title,
                    icon: group.icon ? ICON_MAP[group.icon] : undefined,
                    items: group.items.map(toItem),
                });

                continue;
            }

            const last = result[result.length - 1];

            if (last?.kind === 'items') {
                last.items.push(...group.items.map(toItem));
            } else {
                result.push({ kind: 'items', items: group.items.map(toItem) });
            }
        }

        return result;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigation.main]);

    const user = {
        name: auth?.user?.name || 'System Admin',
        email: auth?.user?.email || 'admin@example.com',
        avatar: auth?.user?.avatar || '',
    };

    const siteName = setting?.site_name || 'CMS';
    const logoUrl = setting?.logo_url;

    return (
        <Sidebar collapsible={fullyHidden ? 'offcanvas' : 'icon'} {...props}>
            <SidebarHeader className="gap-2 px-2 pt-3 pb-1">
                <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col">
                    <div className="flex min-w-0 items-center gap-2">
                        {/* * The logo toggles the sidebar: it is the only control left when collapsed. */}
                        <button
                            type="button"
                            onClick={toggleSidebar}
                            aria-label="Mở rộng hoặc thu gọn thanh bên"
                            className="flex size-8 shrink-0 items-center justify-center rounded-md outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 motion-reduce:transition-none"
                        >
                            {logoUrl ? (
                                <img
                                    src={logoUrl}
                                    alt={siteName}
                                    className="size-6 shrink-0 rounded object-contain"
                                />
                            ) : (
                                <span
                                    title={siteName}
                                    className="flex size-6 shrink-0 items-center justify-center rounded bg-primary text-xs font-semibold text-primary-foreground"
                                >
                                    {siteName.charAt(0).toUpperCase()}
                                </span>
                            )}
                        </button>
                        <span className="truncate text-base font-semibold group-data-[collapsible=icon]:hidden">
                            {siteName}
                        </span>
                    </div>
                    <SidebarTrigger className="group-data-[collapsible=icon]:hidden" />
                </div>
                {/* * Collapsed: the search box is replaced by this icon, which opens the sidebar and focuses the box. */}
                <button
                    type="button"
                    onClick={focusSearch}
                    aria-label="Tìm trong menu"
                    title="Tìm trong menu"
                    className="hidden size-8 items-center justify-center self-center rounded-md text-sidebar-foreground outline-none group-data-[collapsible=icon]:flex hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 motion-reduce:transition-none"
                >
                    <Search aria-hidden="true" className="size-5" />
                </button>
                <div className="relative group-data-[collapsible=icon]:hidden">
                    <Search
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        ref={searchInputRef}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape' && search) {
                                event.preventDefault();
                                setSearch('');
                            }
                        }}
                        aria-label="Tìm trong menu"
                        placeholder="Tìm trong menu..."
                        className="h-9 rounded-sm border-sidebar-border bg-sidebar pr-9 pl-9 shadow-none"
                    />
                    {search && (
                        <button
                            type="button"
                            aria-label="Xóa nội dung tìm kiếm"
                            onClick={() => {
                                setSearch('');
                                searchInputRef.current?.focus();
                            }}
                            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                            <X aria-hidden="true" className="size-4" />
                        </button>
                    )}
                </div>
            </SidebarHeader>
            <SidebarContent className="gap-1 pt-1">
                {search.trim() ? (
                    <NavMain items={items} search={search} />
                ) : (
                    sections.map((section, index) =>
                        section.kind === 'items' ? (
                            <NavMain key={index} items={section.items} />
                        ) : (
                            <NavSubMenu
                                key={section.key}
                                groupKey={section.key}
                                title={section.title}
                                icon={section.icon}
                                items={section.items}
                            />
                        ),
                    )
                )}
            </SidebarContent>
            <SidebarFooter className="border-t border-sidebar-border p-0 py-2">
                <div className="px-2">
                    <NavUser user={user} />
                </div>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
