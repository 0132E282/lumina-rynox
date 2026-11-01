import { Link } from '@inertiajs/react';
import type { PropsWithChildren } from 'react';
import Heading from '@/components/heading';
import { Separator } from '@/components/ui/separator';
import { useCurrentUrl } from '@/hooks/use-current-url';
import { cn } from '@/lib/utils';
import type { NavItem } from '@/types';

const sidebarNavItems: NavItem[] = [
    {
        title: 'Chung',
        href: '/settings/general',
    },
    {
        title: 'SMTP',
        href: '/settings/smtp',
    },
    {
        title: 'Google Search Console',
        href: '/settings/search-console',
    },
    {
        title: 'Google Analytics',
        href: '/settings/google-analytics',
    },
];

export default function SystemSettingsLayout({ children }: PropsWithChildren) {
    const { isCurrentUrl } = useCurrentUrl();

    return (
        <div className="px-4 py-6">
            <Heading
                title="Cấu hình hệ thống"
                description="Tên website, logo, favicon và cấu hình gửi email."
            />

            <div className="flex flex-col space-y-8 md:space-y-0 lg:flex-row lg:space-y-0 lg:space-x-12">
                <aside className="w-full max-w-xl lg:w-48">
                    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
                        {sidebarNavItems.map((item, index) => (
                            <Link
                                key={`${item.href}-${index}`}
                                href={item.href}
                                prefetch
                                className={cn(
                                    'flex min-h-11 shrink-0 items-center rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted lg:w-full lg:justify-start',
                                    {
                                        'bg-muted': isCurrentUrl(item.href),
                                    },
                                )}
                            >
                                {item.title}
                            </Link>
                        ))}
                    </nav>
                </aside>

                <Separator className="my-6 md:hidden" />

                <div className="min-w-0 flex-1">
                    <section className="w-full space-y-12">{children}</section>
                </div>
            </div>
        </div>
    );
}
