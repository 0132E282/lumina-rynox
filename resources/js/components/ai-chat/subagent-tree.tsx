import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useState } from 'react';
import { VendorBadge } from '@/components/ai-chat/vendor-badge';
import type { AiSubagent } from '@/types';
import { cn } from '@/lib/utils';

const NODE_W = 164;
const ROOT_W = 212;
const ROOT_H = 52;
const NODE_MAX_W = 380;
const NODE_H = 56;
const COL_GAP = 160;
const ROW_GAP = 20;
const PAD = 12;
const LOGO = 22;

type Placed = {
    id: string;
    depth: number;
    y: number;
    parent: string | null;
    title: string;
    detail: string;
    meta: string;
    edge: string;
    running: boolean;
    seconds: number;
    tokens: number | null;
    files: string[];
};

const tokenLabel = (tokens: number) =>
    `${tokens >= 1000 ? `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k` : tokens} token`;

const clip = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** * Subagent flow diagram, left to right: the AI answering on the left, an arrow to each subagent it started, rectangular nodes with role, the task it was given, step and time. */
export function SubagentTree({
    subagents,
    rootName,
    now,
    working,
    vendorKey,
    vendorLabel,
}: {
    subagents: AiSubagent[];
    rootName: string;
    now: number;
    /** * An AI is answering right now. */
    working: boolean;
    /** * The AI vendor whose logo marks every node (all subagents run on the same AI). */
    vendorKey: string;
    vendorLabel: string;
}) {
    const [openId, setOpenId] = useState<string | null>(null);
    const known = new Set(subagents.map((agent) => agent.id));
    // * A parent that is not a known subagent (the main AI, or an id never seen) hangs from the root.
    const childrenOf = (id: string | null) =>
        subagents.filter((agent) =>
            id === null
                ? agent.parent === null || !known.has(agent.parent)
                : agent.parent === id,
        );

    const placed: Placed[] = [];
    let leaf = 0;

    // * Leaves take the next row; a parent sits in the middle of its children, so arrows fan out evenly.
    const place = (agent: AiSubagent, depth: number, parent: string | null) => {
        const children = childrenOf(agent.id);
        const start = placed.length;
        const index = placed.push({
            id: agent.id,
            depth,
            y: 0,
            parent,
            title: agent.role,
            detail: agent.step,
            meta: `${agent.status === 'running' ? '' : 'Xong · '}${Math.max(0, Math.floor(((agent.endedAt ?? now) - agent.startedAt) / 1000))}s${agent.tokens ? ` · ${tokenLabel(agent.tokens)}` : ''}`,
            edge: agent.task,
            running: agent.status === 'running',
            seconds: Math.max(
                0,
                Math.floor(((agent.endedAt ?? now) - agent.startedAt) / 1000),
            ),
            tokens: agent.tokens ?? null,
            files: agent.files ?? [],
        });

        if (children.length === 0) {
            placed[index - 1].y = leaf++;

            return;
        }

        children.forEach((child) => place(child, depth + 1, agent.id));

        const ys = placed
            .slice(start + 1)
            .filter((node) => node.parent === agent.id)
            .map((node) => node.y);

        placed[index - 1].y = (Math.min(...ys) + Math.max(...ys)) / 2;
    };

    const top = childrenOf(null);

    top.forEach((agent) => place(agent, 1, 'root'));

    const rows = Math.max(1, leaf);
    const rootRow =
        top.length === 0
            ? 0
            : (Math.min(
                  ...placed.filter((n) => n.parent === 'root').map((n) => n.y),
              ) +
                  Math.max(
                      ...placed
                          .filter((n) => n.parent === 'root')
                          .map((n) => n.y),
                  )) /
              2;
    const maxDepth = Math.max(0, ...placed.map((node) => node.depth));
    // * A column is as wide as its longest line needs (task, step), from 164px up to 380px; every node of the column has that width.
    const colW = Array.from({ length: maxDepth + 1 }, (_, depth) =>
        depth === 0
            ? ROOT_W
            : Math.min(
                  NODE_MAX_W,
                  Math.max(
                      NODE_W,
                      ...placed
                          .filter((node) => node.depth === depth)
                          .map((node) =>
                              Math.max(
                                  (node.title.length + node.edge.length + 2) *
                                      6.6 +
                                      10 +
                                      130,
                                  node.detail.length * 6.2 + 28,
                              ),
                          ),
                  ),
              ),
    );
    const x = (depth: number) =>
        PAD + colW.slice(0, depth).reduce((sum, w) => sum + w + COL_GAP, 0);
    const y = (row: number) => PAD + row * (NODE_H + ROW_GAP);
    const width = x(maxDepth) + colW[maxDepth] + PAD;
    const height = y(rows - 1) + NODE_H + PAD;

    const byId = new Map(placed.map((node) => [node.id, node]));
    const openAgent = openId === null ? undefined : byId.get(openId);
    const nodePos = (id: string) => {
        if (id === 'root') {
            return { depth: 0, row: rootRow };
        }

        const node = byId.get(id)!;

        return { depth: node.depth, row: node.y };
    };

    const arrow = (from: string, node: Placed) => {
        const a = nodePos(from);
        const x1 = x(a.depth) + colW[a.depth];
        const y1 = y(a.row) + NODE_H / 2;
        const x2 = x(node.depth);
        const y2 = y(node.y) + NODE_H / 2;

        return {
            x1,
            y1,
            x2,
            y2,
        };
    };

    // * The AI's logo inside the SVG (a foreignObject holds the same badge the composer uses).
    const logo = (lx: number, ly: number) => (
        <foreignObject x={lx} y={ly} width={LOGO} height={LOGO}>
            <VendorBadge
                vendorKey={vendorKey}
                fallback={vendorLabel}
                className="size-[22px] rounded text-[10px]"
            />
        </foreignObject>
    );

    return (
        <div className="flex flex-1 items-center overflow-auto">
            <svg
                role="img"
                aria-label="Sơ đồ agent"
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                className="shrink-0 text-muted-foreground"
            >
                <style>{`
                    @keyframes subagent-flow { to { stroke-dashoffset: -14; } }
                    .subagent-edge-run { animation: subagent-flow 0.8s linear infinite; }
                    @media (prefers-reduced-motion: reduce) { .subagent-edge-run { animation: none; } }
                `}</style>
                <defs>
                    <marker
                        id="subagent-arrow"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="8"
                        markerHeight="8"
                        orient="auto-start-reverse"
                    >
                        <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
                    </marker>
                </defs>
                {placed.map((node) => {
                    const e = arrow(node.parent ?? 'root', node);

                    return (
                        <g key={`edge-${node.id}`}>
                            <path
                                d={`M${e.x1} ${e.y1} H${(e.x1 + e.x2) / 2} V${e.y2} H${e.x2}`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeDasharray="6 8"
                                strokeLinecap="round"
                                className={
                                    node.running
                                        ? 'subagent-edge-run'
                                        : undefined
                                }
                                markerEnd="url(#subagent-arrow)"
                            />
                        </g>
                    );
                })}
                <g>
                    <rect
                        x={x(0)}
                        y={y(rootRow) + (NODE_H - ROOT_H) / 2}
                        width={ROOT_W}
                        height={ROOT_H}
                        rx="8"
                        className="fill-primary/10 stroke-primary/40"
                    />
                    {logo(x(0) + 8, y(rootRow) + (NODE_H - LOGO) / 2)}
                    <text
                        x={x(0) + 8 + LOGO + 6}
                        y={y(rootRow) + NODE_H / 2 + 4}
                        className="fill-foreground text-[13px] font-semibold"
                    >
                        {clip(rootName, 22)}
                    </text>
                    {working && (
                        <circle
                            cx={x(0) + ROOT_W - 12}
                            cy={y(rootRow) + NODE_H / 2}
                            r="3.5"
                            className="animate-pulse fill-emerald-500 motion-reduce:animate-none"
                        />
                    )}
                </g>
                {placed.map((node) => (
                    <g
                        key={node.id}
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer outline-none"
                        onClick={() => setOpenId(node.id)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setOpenId(node.id);
                            }
                        }}
                    >
                        <title>{`${node.title}${node.edge ? ` · ${node.edge}` : ''}${node.meta ? ` · ${node.meta}` : ''}${node.detail ? ` · ${node.detail}` : ''}`}</title>
                        <rect
                            x={x(node.depth)}
                            y={y(node.y)}
                            width={colW[node.depth]}
                            height={NODE_H}
                            rx="8"
                            className={cn(
                                'stroke-border',
                                node.running ? 'fill-muted' : 'fill-muted/50',
                            )}
                        />
                        {(() => {
                            // * "agent: task" on one line (the role in bold), the time at the right end.
                            const room = Math.floor(
                                (colW[node.depth] - 10 - 130) / 6.6,
                            );
                            const head = clip(
                                node.edge
                                    ? `${node.title}: ${node.edge}`
                                    : node.title,
                                room,
                            );
                            const bold = head.slice(0, node.title.length);

                            return (
                                <text
                                    x={x(node.depth) + 10}
                                    y={y(node.y) + 23}
                                    className="fill-foreground text-[12px]"
                                >
                                    <tspan className="font-semibold">
                                        {bold}
                                    </tspan>
                                    {head.slice(node.title.length)}
                                </text>
                            );
                        })()}
                        {node.meta && (
                            <text
                                x={x(node.depth) + colW[node.depth] - 8}
                                y={y(node.y) + 23}
                                textAnchor="end"
                                className="fill-current text-[10px]"
                            >
                                {node.meta}
                            </text>
                        )}
                        <text
                            x={x(node.depth) + 10}
                            y={y(node.y) + 45}
                            className="fill-current font-mono text-[10px]"
                        >
                            {clip(
                                node.detail ||
                                    (node.running ? 'Đang làm…' : ''),
                                Math.floor((colW[node.depth] - 20) / 6.1),
                            )}
                        </text>
                    </g>
                ))}
            </svg>
            <Dialog
                open={openAgent !== undefined}
                onOpenChange={(value) => !value && setOpenId(null)}
            >
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="flex flex-wrap items-center gap-2">
                            {openAgent?.title}
                            <span
                                className={cn(
                                    'rounded-full px-2 py-0.5 text-xs font-medium',
                                    openAgent?.running
                                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                        : 'bg-muted text-muted-foreground',
                                )}
                            >
                                {openAgent?.running ? 'Đang chạy' : 'Đã xong'}
                            </span>
                        </DialogTitle>
                        <DialogDescription className="sr-only">
                            Việc được giao, bước đang chạy và các file agent đã
                            sửa.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-3 text-sm">
                        <dl className="flex gap-2 text-xs">
                            <div className="min-w-0 flex-1 rounded-md border px-2 py-1">
                                <dt className="text-muted-foreground">
                                    Thời gian
                                </dt>
                                <dd className="font-medium tabular-nums">
                                    {openAgent?.seconds}s
                                </dd>
                            </div>
                            {openAgent?.tokens != null && (
                                <div className="min-w-0 flex-1 rounded-md border px-2 py-1">
                                    <dt className="text-muted-foreground">
                                        Token
                                    </dt>
                                    <dd className="font-medium tabular-nums">
                                        {tokenLabel(openAgent.tokens)}
                                    </dd>
                                </div>
                            )}
                            <div className="min-w-0 flex-1 rounded-md border px-2 py-1">
                                <dt className="text-muted-foreground">
                                    File đã sửa
                                </dt>
                                <dd className="font-medium tabular-nums">
                                    {openAgent?.files.length}
                                </dd>
                            </div>
                        </dl>
                        <section className="flex flex-col gap-1">
                            <h4 className="text-xs font-medium text-muted-foreground">
                                Việc được giao
                            </h4>
                            <p className="break-words whitespace-pre-wrap">
                                {openAgent?.edge || '—'}
                            </p>
                        </section>
                        {openAgent?.running && (
                            <section className="flex flex-col gap-1">
                                <h4 className="text-xs font-medium text-muted-foreground">
                                    Đang thực thi
                                </h4>
                                <p className="font-mono text-xs break-words whitespace-pre-wrap">
                                    {openAgent.detail || 'Đang làm…'}
                                </p>
                            </section>
                        )}
                        {openAgent !== undefined &&
                            openAgent.files.length > 0 && (
                                <section className="flex flex-col gap-1">
                                    <h4 className="text-xs font-medium text-muted-foreground">
                                        File đã sửa
                                    </h4>
                                    <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto font-mono text-xs">
                                        {openAgent.files.map((file) => (
                                            <li
                                                key={file}
                                                className="break-all"
                                            >
                                                {file}
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
