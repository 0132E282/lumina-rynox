import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** * Same `filters[field][op]` shape as the index endpoint, e.g. `{ status: { _eq: 'completed' } }`. */
type Filters = Record<string, Record<string, unknown>>;

export type DashboardCardConfig = {
    title: string;
    icon: LucideIcon;
    filters?: Filters;
    aggregate?: 'count' | 'sum';
    /** * Required for aggregate 'sum'. */
    field?: string;
    render: (value: number) => string;
};

/** * Cards are aggregated server-side (`ItemController::dashboards`) over the full data set, not the loaded page. */
export function DashboardCards({
    cards,
    collection,
}: {
    cards: DashboardCardConfig[];
    collection: string;
}) {
    const [values, setValues] = useState<number[]>();

    useEffect(() => {
        let cancelled = false;

        api.post<{ data: number[] }>(
            window.route('items.dashboards', { resource: collection }),
            {
                cards: cards.map(({ filters, aggregate, field }) => ({
                    filters,
                    aggregate,
                    field,
                })),
            },
        ).then((response) => {
            if (!cancelled) {
                setValues(response.data.data);
            }
        });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        collection,
        JSON.stringify(
            cards.map(({ filters, aggregate, field }) => ({
                filters,
                aggregate,
                field,
            })),
        ),
    ]);

    const scrolls = cards.length >= 5;

    return (
        <div
            className={scrolls ? 'flex gap-4 overflow-x-auto' : 'grid gap-4'}
            style={
                scrolls
                    ? undefined
                    : {
                          gridTemplateColumns: `repeat(${cards.length}, minmax(200px, 1fr))`,
                      }
            }
        >
            {cards.map(({ title, icon: Icon, render }, index) => (
                <div
                    key={title}
                    className={`flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm ${scrolls ? 'w-52 shrink-0' : ''}`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                            {title}
                        </span>
                        <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <span className="text-2xl leading-tight font-bold">
                        {values ? render(values[index]) : '—'}
                    </span>
                </div>
            ))}
        </div>
    );
}
