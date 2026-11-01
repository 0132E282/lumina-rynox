import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

export interface TrafficTrendPoint {
    date: string;
    visitors: number;
    pageViews: number;
}

const numberFormat = new Intl.NumberFormat('vi-VN');

function formatDate(date: string): string {
    return new Intl.DateTimeFormat('vi-VN', {
        day: 'numeric',
        month: 'short',
    }).format(new Date(`${date}T00:00:00`));
}

export default function TrafficChart({
    trend,
}: {
    trend: TrafficTrendPoint[];
}) {
    return (
        <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart
                    data={trend}
                    margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                >
                    <CartesianGrid
                        vertical={false}
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                    />
                    <XAxis
                        dataKey="date"
                        tickFormatter={formatDate}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={28}
                        tick={{
                            fill: 'var(--muted-foreground)',
                            fontSize: 12,
                        }}
                    />
                    <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={40}
                        tick={{
                            fill: 'var(--muted-foreground)',
                            fontSize: 12,
                        }}
                    />
                    <Tooltip
                        labelFormatter={(label) => formatDate(String(label))}
                        formatter={(value, name) => [
                            numberFormat.format(Number(value)),
                            name === 'visitors'
                                ? 'Khách truy cập'
                                : 'Lượt xem trang',
                        ]}
                        contentStyle={{
                            borderRadius: 8,
                            borderColor: 'var(--border)',
                            backgroundColor: 'var(--popover)',
                            color: 'var(--popover-foreground)',
                        }}
                    />
                    <Line
                        type="monotone"
                        dataKey="visitors"
                        name="visitors"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                    <Line
                        type="monotone"
                        dataKey="pageViews"
                        name="pageViews"
                        stroke="var(--chart-2)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
