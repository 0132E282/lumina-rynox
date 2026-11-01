import type { ReactNode } from 'react';

/** * One card per status with its row count and an optional extra line (e.g. revenue). */
export function StatusSummaryCards<TStatus extends string, TRow>({
    statuses,
    labelMap,
    rows,
    statusOf,
    renderExtra,
}: {
    statuses: TStatus[];
    labelMap: Record<TStatus, string>;
    rows: TRow[];
    statusOf: (row: TRow) => TStatus;
    renderExtra?: (rowsInStatus: TRow[]) => ReactNode;
}) {
    return (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {statuses.map((status) => {
                const rowsInStatus = rows.filter(
                    (row) => statusOf(row) === status,
                );

                return (
                    <div
                        key={status}
                        className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm"
                    >
                        <span className="text-xs font-medium text-muted-foreground">
                            {labelMap[status]}
                        </span>
                        <span className="text-2xl leading-tight font-bold">
                            {rowsInStatus.length}
                        </span>
                        {renderExtra && (
                            <span className="text-xs text-muted-foreground">
                                {renderExtra(rowsInStatus)}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
