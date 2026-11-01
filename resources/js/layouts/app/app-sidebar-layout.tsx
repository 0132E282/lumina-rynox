import { usePage } from '@inertiajs/react';
import * as React from 'react';
import { AiPanel } from '@/components/ai/ai-panel';
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerTitle,
} from '@/components/ui/drawer';
import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { ChildSidebarPanel } from '@/components/child-sidebar-panel';
import { AiPanelContext } from '@/contexts/ai-panel-context';
import { ChildSidebarContext } from '@/contexts/child-sidebar-context';
import type { ChildSidebarGroup } from '@/contexts/child-sidebar-context';
import { HeaderActionsProvider } from '@/contexts/header-actions';
import { LocaleProvider } from '@/contexts/locale-context';
import { SidebarFullyHiddenContext } from '@/contexts/sidebar-collapse-context';

export default function Page({ children }: { children: React.ReactNode }) {
    const fullyHiddenState = React.useState(false);
    const aiPanelState = React.useState(false);
    const childSidebarState = React.useState<ChildSidebarGroup | null>(null);
    const { canUseAi } = usePage().props;
    const { url } = usePage();
    const [aiPanelOpen, setAiPanelOpen] = aiPanelState;
    // * The AI home is the full assistant, so the right-hand AI drawer is not offered there.
    const onAiHome = url === '/' || url.startsWith('/?');
    const onChat = ['/', '/chat', '/inbox'].some(
        (path) =>
            url === path ||
            url.startsWith(`${path}?`) ||
            url.startsWith(`${path}/`),
    );

    // * A reload starts with the sidebar open and folds it right after mount (single-item pages); that fold must not animate.
    React.useLayoutEffect(() => {
        const root = document.documentElement;

        root.classList.add('no-transitions');

        let second = 0;
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() =>
                root.classList.remove('no-transitions'),
            );
        });

        return () => {
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
            root.classList.remove('no-transitions');
        };
    }, []);

    return (
        <LocaleProvider>
            <HeaderActionsProvider>
                <SidebarFullyHiddenContext.Provider value={fullyHiddenState}>
                    <AiPanelContext.Provider value={aiPanelState}>
                        <ChildSidebarContext.Provider value={childSidebarState}>
                            <SidebarProvider
                                // * The menu panel starts closed: only the icon rail shows until a group is clicked.
                                defaultOpen={false}
                                style={
                                    {
                                        '--sidebar-width':
                                            'calc(var(--spacing) * 60)',
                                        '--sidebar-width-icon':
                                            'calc(var(--spacing) * 14)',
                                        '--header-height':
                                            'calc(var(--spacing) * 14)',
                                    } as React.CSSProperties
                                }
                            >
                                <a
                                    href="#admin-content"
                                    className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
                                >
                                    Đi đến nội dung
                                </a>
                                <AppSidebar variant="sidebar" />
                                <ChildSidebarPanel />
                                <SidebarInset
                                    id="admin-content"
                                    tabIndex={-1}
                                    className="overflow-hidden border border-border shadow-none outline-none"
                                >
                                    {/* * The chat screens use the full height: no admin header there. */}
                                    {!onChat && <SiteHeader />}
                                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto outline-none">
                                        {children}
                                    </div>
                                </SidebarInset>
                                {/* * Right-hand AI panel: a drawer sliding in from the right. */}
                                {canUseAi && !onAiHome && (
                                    <Drawer
                                        direction="right"
                                        open={aiPanelOpen}
                                        onOpenChange={setAiPanelOpen}
                                    >
                                        <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-md">
                                            <DrawerTitle className="sr-only">
                                                Trợ lý AI
                                            </DrawerTitle>
                                            <DrawerDescription className="sr-only">
                                                Hỏi trợ lý AI; trợ lý chỉ soạn
                                                văn bản, không tự gửi tin hay
                                                đăng bài.
                                            </DrawerDescription>
                                            <AiPanel
                                                onClose={() =>
                                                    setAiPanelOpen(false)
                                                }
                                            />
                                        </DrawerContent>
                                    </Drawer>
                                )}
                            </SidebarProvider>
                        </ChildSidebarContext.Provider>
                    </AiPanelContext.Provider>
                </SidebarFullyHiddenContext.Provider>
            </HeaderActionsProvider>
        </LocaleProvider>
    );
}
