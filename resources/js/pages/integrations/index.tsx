import { Head, Link } from '@inertiajs/react';
import { show } from '@/actions/App/Http/Controllers/IntegrationController';
import { PlatformLogo } from '@/components/social/platform-logo';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { IntegrationCard, IntegrationGroup } from '@/types';

function IntegrationStatusBadge({ card }: { card: IntegrationCard }) {
    if (card.status === 'disconnected') {
        return null;
    }

    return (
        <Badge
            variant={card.status === 'error' ? 'destructive' : 'secondary'}
            className={cn(
                card.status === 'connected' &&
                    card.active &&
                    'bg-chart-2/15 text-foreground',
                card.status === 'connected' &&
                    !card.active &&
                    'bg-muted text-foreground',
            )}
        >
            {card.status_label}
        </Badge>
    );
}

function IntegrationCardItem({ card }: { card: IntegrationCard }) {
    const isConnected = card.active && card.status === 'connected';
    const actionLabel = isConnected ? 'Quản lý kênh' : 'Thiết lập';

    return (
        <Card className="relative h-full gap-3 py-4 focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-accent/40">
            <CardContent className="flex h-full flex-col gap-3 px-4">
                <div className="flex items-start gap-3">
                    <PlatformLogo
                        provider={card.key}
                        letter={card.letter}
                        color={card.color}
                        className="size-9 rounded-md text-sm"
                    />
                    <h3 className="min-w-0 flex-1 truncate pt-1.5 font-medium">
                        {card.name}
                    </h3>
                    <IntegrationStatusBadge card={card} />
                </div>
                <p className="line-clamp-2 flex-1 text-sm text-muted-foreground">
                    {card.description}
                </p>
                {card.accounts !== null && (
                    <p className="text-sm font-medium">
                        {card.accounts.connected} tài khoản kết nối
                        {card.accounts.total > card.accounts.connected
                            ? ` / ${card.accounts.total} tài khoản`
                            : ''}
                    </p>
                )}
                <Link
                    href={show.url({ provider: card.key })}
                    aria-label={`${actionLabel} ${card.name}${
                        card.status === 'error' ? ' (lỗi kết nối)' : ''
                    }`}
                    className={cn(
                        buttonVariants({
                            variant: isConnected ? 'default' : 'secondary',
                        }),
                        'w-full outline-none after:absolute after:inset-0 after:content-[""]',
                    )}
                >
                    {actionLabel}
                </Link>
            </CardContent>
        </Card>
    );
}

export default function IntegrationIndex({
    groups,
}: {
    groups: IntegrationGroup[];
}) {
    return (
        <>
            <Head title="Tích hợp" />
            <div className="flex flex-col gap-8 p-4 lg:p-6">
                <header className="flex flex-col gap-1">
                    <h1 className="text-xl font-semibold">Tích hợp</h1>
                    <p className="text-sm text-muted-foreground">
                        Kết nối các kênh chat, mạng xã hội, lịch và nguồn việc
                        làm vào Personal Manager.
                    </p>
                </header>
                {groups.map((group) => (
                    <section
                        key={group.key}
                        aria-labelledby={`integration-group-${group.key}`}
                        className="flex flex-col gap-3"
                    >
                        <h2
                            id={`integration-group-${group.key}`}
                            className="text-base font-semibold"
                        >
                            {group.title}
                        </h2>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {group.providers.map((card) => (
                                <IntegrationCardItem
                                    key={card.key}
                                    card={card}
                                />
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </>
    );
}
