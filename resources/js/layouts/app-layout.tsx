import { useAccountHeartbeat } from '@/hooks/use-account-heartbeat';
import AppLayoutTemplate from '@/layouts/app/app-sidebar-layout';
import type { BreadcrumbItem } from '@/types';

export default function AppLayout({
    breadcrumbs = [],
    children,
}: {
    breadcrumbs?: BreadcrumbItem[];
    children: React.ReactNode;
}) {
    useAccountHeartbeat();

    return <AppLayoutTemplate>{children}</AppLayoutTemplate>;
}
