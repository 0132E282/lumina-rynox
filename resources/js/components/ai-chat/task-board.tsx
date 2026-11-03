import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, MessageSquare, Play } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VendorBadge } from '@/components/ai-chat/vendor-badge';
import { cn } from '@/lib/utils';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { PlanEntry, PlanTask } from '@/lib/project-plans';
import type { AiPlanItem, AiSubagent } from '@/types';

type Card = {
    key: string;
    text: string;
    badge: string | null;
    detail: string | null;
    /** * What the popup of the card shows. */
    info: { label: string; lines: string[] }[];
};

type ColumnId = 'todo' | 'doing' | 'review' | 'test' | 'done';

const COLUMNS = [
    { id: 'todo', label: 'Chờ', dot: 'bg-muted-foreground/50' },
    { id: 'doing', label: 'Đang làm', dot: 'bg-emerald-500' },
    { id: 'review', label: 'Đang review', dot: 'bg-amber-500' },
    { id: 'test', label: 'Đang test', dot: 'bg-sky-500' },
    { id: 'done', label: 'Hoàn thành', dot: 'bg-primary' },
] as const;

/** * Kanban of one answer: the plan lines the AI wrote (to-do list) and the subagents it handed work to, in columns that move on their own; a card can also be dragged to another column. */
export function TaskBoard({
    plan,
    subagents,
    projectPlans = [],
    selectedPlan = null,
    onSelectPlan,
    projectTasks = [],
    planError = null,
    onStartPlan,
    startDisabled = false,
    onChatAbout,
    vendorKey = '',
    vendorLabel = 'AI',
}: {
    /** * The AI that takes the tasks: its logo marks every card an agent has picked up. */
    vendorKey?: string;
    vendorLabel?: string;
    /** * "Chat với AI": puts the opened card in the draft so the person can say what to change. */
    onChatAbout?: (
        card: { badge: string | null; text: string },
        feedback: string,
    ) => void;
    /** * Plans of `docs/plans/index.json` of the picked project, the chosen one and its tasks (read-only). */
    projectPlans?: PlanEntry[];
    selectedPlan?: string | null;
    onSelectPlan?: (path: string) => void;
    projectTasks?: PlanTask[];
    planError?: string | null;
    /** * "Bắt đầu": hands the chosen plan to the AI to work through. */
    onStartPlan?: () => void;
    startDisabled?: boolean;
    plan: AiPlanItem[];
    subagents: AiSubagent[];
}) {
    const [open, setOpen] = useState<Card | null>(null);
    // * The small chat box of the popup ("Chat với AI để sửa"): what to change about this card.
    const [chatting, setChatting] = useState(false);
    const [feedback, setFeedback] = useState('');
    const sendFeedback = () => {
        const text = feedback.trim();

        if (open && onChatAbout && text !== '') {
            onChatAbout(open, text);
            setOpen(null);
            setChatting(false);
            setFeedback('');
        }
    };
    // * Cards the person dragged to another column (card key => column): kept per plan, so a reload keeps them.
    const storageKey = `ai-chat.board.${selectedPlan ?? ''}`;
    const [moved, setMoved] = useState<
        Record<string, { from: ColumnId; to: ColumnId }>
    >({});
    // * The column each card belongs to by its own state (not by a drag), refreshed on every render.
    const naturals = useRef<Record<string, ColumnId>>({});
    // * A drag only holds while the card's own state is what it was when dropped: once the agent moves on, the board follows it.
    const isMoved = (key: string) =>
        moved[key] !== undefined && moved[key].from === naturals.current[key];
    const [dragKey, setDragKey] = useState<string | null>(null);
    const [overColumn, setOverColumn] = useState<ColumnId | null>(null);

    useEffect(() => {
        try {
            setMoved(JSON.parse(localStorage.getItem(storageKey) ?? '{}'));
        } catch {
            setMoved({});
        }
    }, [storageKey]);

    // * Plan tasks the subagents took on or finished (task id => state), kept per plan: the agents are gone after the answer, the board must not forget what they did.
    const progressKey = `ai-chat.progress.${selectedPlan ?? ''}`;
    const [progress, setProgress] = useState<Record<string, 'doing' | 'done'>>(
        {},
    );

    // * Files the agents edited for a task (task id => paths), kept like the progress.
    const filesKey = `ai-chat.files.${selectedPlan ?? ''}`;
    const [taskFiles, setTaskFiles] = useState<Record<string, string[]>>({});

    useEffect(() => {
        try {
            setTaskFiles(JSON.parse(localStorage.getItem(filesKey) ?? '{}'));
        } catch {
            setTaskFiles({});
        }
    }, [filesKey]);

    useEffect(() => {
        try {
            setProgress(JSON.parse(localStorage.getItem(progressKey) ?? '{}'));
        } catch {
            setProgress({});
        }
    }, [progressKey]);

    // * A card that changes column glides from where it was to where it is now (and flashes), so the person sees which task just moved.
    const cardRefs = useRef(new Map<string, HTMLLIElement>());
    const lastSeen = useRef(
        new Map<string, { column: string | undefined; rect: DOMRect }>(),
    );

    useLayoutEffect(() => {
        const calm = window.matchMedia(
            '(prefers-reduced-motion: reduce)',
        ).matches;
        const next = new Map<
            string,
            { column: string | undefined; rect: DOMRect }
        >();

        cardRefs.current.forEach((element, key) => {
            const rect = element.getBoundingClientRect();
            const column = element.dataset.column;
            const before = lastSeen.current.get(key);

            next.set(key, { column, rect });

            if (!calm && before && before.column !== column) {
                element.animate(
                    [
                        {
                            transform: `translate(${before.rect.left - rect.left}px, ${before.rect.top - rect.top}px)`,
                            boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.9)',
                        },
                        {
                            transform: 'none',
                            boxShadow: '0 0 0 2px rgba(16, 185, 129, 0)',
                        },
                    ],
                    { duration: 600, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
                );
            }
        });
        lastSeen.current = next;
    });

    // * "Bắt đầu" is a new run: what an earlier run left (done tasks, their files, dragged cards) must not stay on the board.
    const resetProgress = () => {
        setProgress({});
        setTaskFiles({});
        setMoved({});

        try {
            localStorage.removeItem(progressKey);
            localStorage.removeItem(filesKey);
            localStorage.removeItem(storageKey);
        } catch {
            // * Storage blocked: the board is cleared until the panel closes.
        }
    };

    const drop = (column: ColumnId) => {
        if (dragKey !== null) {
            const from = naturals.current[dragKey];
            const next = from
                ? { ...moved, [dragKey]: { from, to: column } }
                : moved;

            setMoved(next);

            try {
                localStorage.setItem(storageKey, JSON.stringify(next));
            } catch {
                // * Storage blocked: the move still holds until the panel closes.
            }
        }

        setDragKey(null);
        setOverColumn(null);
    };

    const columns: Record<ColumnId, Card[]> = {
        todo: [],
        doing: [],
        review: [],
        test: [],
        done: [],
    };

    // * A running card moves to "Đang review" / "Đang test" when its role or text says so (reviewer, qa-tester, "kiểm thử"...); otherwise it is plain work.
    const runningColumn = (text: string) =>
        /review|duyệt/i.test(text)
            ? 'review'
            : /test|qa\b|kiểm thử/i.test(text)
              ? 'test'
              : 'doing';

    // * A plan task that a subagent or a to-do line names by its id (TASK-1...) is being worked on, or done once that one is: the board moves it by itself. The main agent's own card is left out, since its message lists every task.
    const live = [
        ...subagents.map((agent) => ({
            text: `${agent.task} ${agent.step}`,
            done: agent.status === 'done',
        })),
        ...plan.map((item) => ({
            text: item.content,
            done: item.status === 'completed',
        })),
    ];
    const liveState = (id: string | null): 'doing' | 'done' | null => {
        if (!id) {
            return null;
        }

        const pattern = new RegExp(
            `(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`,
            'i',
        );
        const mentions = live.filter((item) => pattern.test(item.text));

        return mentions.length === 0
            ? null
            : mentions.some((item) => !item.done)
              ? 'doing'
              : 'done';
    };

    const taskPattern = (id: string) =>
        new RegExp(
            `(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`,
            'i',
        );
    const filesOf = (id: string | null) => {
        if (!id) {
            return [];
        }

        const pattern = taskPattern(id);
        const live = subagents
            .filter((agent) => pattern.test(agent.task))
            .flatMap((agent) => agent.files ?? []);

        return [...new Set([...(taskFiles[id] ?? []), ...live])];
    };
    const liveFilesSig = projectTasks
        .map((task) => filesOf(task.id).join('|'))
        .join(',');

    useEffect(() => {
        const next = { ...taskFiles };
        let changed = false;

        projectTasks.forEach((task) => {
            const files = filesOf(task.id);

            if (task.id && files.length > (next[task.id]?.length ?? 0)) {
                next[task.id] = files;
                changed = true;
            }
        });

        if (changed) {
            setTaskFiles(next);

            try {
                localStorage.setItem(filesKey, JSON.stringify(next));
            } catch {
                // * Storage blocked: the list holds until the panel closes.
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveFilesSig, filesKey]);

    const liveStates = projectTasks.map((task) => liveState(task.id));
    const liveSig = liveStates.join(',');

    // * Remember what the agents reported; a finished task never goes back to "doing".
    useEffect(() => {
        const next = { ...progress };
        let changed = false;

        projectTasks.forEach((task, index) => {
            const state = liveStates[index];

            if (
                task.id &&
                state &&
                next[task.id] !== state &&
                next[task.id] !== 'done'
            ) {
                next[task.id] = state;
                changed = true;
            }
        });

        if (changed) {
            setProgress(next);

            try {
                localStorage.setItem(progressKey, JSON.stringify(next));
            } catch {
                // * Storage blocked: the state holds until the panel closes.
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveSig, progressKey]);

    // * A dragged card sits in the column it was dropped on; the others in the one their state says.
    const place = (column: ColumnId, card: Card) => {
        naturals.current[card.key] = column;
        columns[isMoved(card.key) ? moved[card.key].to : column].push(card);
    };

    projectTasks.forEach((task, index) => {
        const status =
            task.status === 'todo'
                ? ((task.id && progress[task.id] === 'done' ? 'done' : null) ??
                  liveState(task.id) ??
                  (task.id ? progress[task.id] : undefined) ??
                  'todo')
                : task.status;
        const column =
            status === 'done'
                ? 'done'
                : status === 'doing'
                  ? runningColumn(task.title)
                  : 'todo';

        place(column, {
            key: `file-${task.id ?? index}`,
            text: task.title,
            badge: task.id,
            detail: status === 'blocked' ? 'Bị chặn' : null,
            info: [
                ...(task.details.length > 0
                    ? task.details
                    : [{ label: 'Việc cần làm', lines: [task.title] }]),
                ...(filesOf(task.id).length > 0
                    ? [{ label: 'File đã sửa', lines: filesOf(task.id) }]
                    : []),
            ],
        });
    });

    plan.forEach((item, index) => {
        const column =
            item.status === 'completed'
                ? 'done'
                : item.status === 'in_progress'
                  ? runningColumn(item.content)
                  : 'todo';

        place(column, {
            key: `plan-${index}`,
            text: item.content,
            badge: null,
            detail: null,
            info: [{ label: 'Việc cần làm', lines: [item.content] }],
        });
    });

    subagents.forEach((agent) => {
        place(
            agent.status === 'done'
                ? 'done'
                : runningColumn(`${agent.role} ${agent.task}`),
            {
                key: `agent-${agent.id}`,
                text: agent.task || agent.step,
                badge: agent.role,
                detail: agent.task ? agent.step : null,
                info: [
                    {
                        label: 'Việc được giao',
                        lines: [agent.task || agent.step],
                    },
                    { label: 'Bước hiện tại', lines: [agent.step] },
                ],
            },
        );
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <h3 className="sr-only">Bảng việc</h3>
            {projectPlans.length > 0 && (
                <div className="flex items-center gap-2 text-sm">
                    <Select
                        value={selectedPlan ?? ''}
                        onValueChange={(value) => onSelectPlan?.(value)}
                    >
                        <SelectTrigger
                            aria-label="Plan"
                            className="max-w-md min-w-0 flex-1"
                        >
                            <SelectValue placeholder="Chọn plan" />
                        </SelectTrigger>
                        <SelectContent>
                            {projectPlans.map((entry) => (
                                <SelectItem key={entry.path} value={entry.path}>
                                    {entry.title}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {onStartPlan && (
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                resetProgress();
                                onStartPlan();
                            }}
                            disabled={
                                startDisabled || projectTasks.length === 0
                            }
                        >
                            {startDisabled ? (
                                <Loader2
                                    aria-hidden="true"
                                    className="animate-spin motion-reduce:animate-none"
                                />
                            ) : (
                                <Play aria-hidden="true" />
                            )}
                            {startDisabled ? 'Đang làm' : 'Bắt đầu'}
                        </Button>
                    )}
                    {planError && (
                        <span role="alert" className="text-xs text-destructive">
                            {planError}
                        </span>
                    )}
                </div>
            )}
            <div className="flex min-h-0 flex-1 snap-x snap-mandatory [scrollbar-width:thin] gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-1 md:snap-none">
                {COLUMNS.map((column) => (
                    <section
                        key={column.id}
                        aria-label={column.label}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setOverColumn(column.id);
                        }}
                        onDragLeave={(event) => {
                            // * Leaving for a child of the column (a card) is not leaving the column.
                            if (
                                !event.currentTarget.contains(
                                    event.relatedTarget as Node | null,
                                )
                            ) {
                                setOverColumn(null);
                            }
                        }}
                        onDrop={(event) => {
                            event.preventDefault();
                            drop(column.id);
                        }}
                        className={cn(
                            'flex min-h-0 w-[17rem] min-w-[15rem] flex-1 shrink-0 snap-start [scrollbar-width:thin] flex-col gap-2 overflow-y-auto overscroll-contain rounded-xl border bg-muted/30 p-3 transition-colors duration-150 motion-reduce:transition-none',
                            overColumn === column.id &&
                                'border-primary/60 bg-primary/5',
                        )}
                    >
                        <h4 className="flex items-center justify-between px-1 text-sm font-medium">
                            <span className="flex items-center gap-2">
                                <span
                                    aria-hidden="true"
                                    className={`size-2 rounded-full ${column.dot}`}
                                />
                                {column.label}
                            </span>
                            <span className="rounded-full bg-muted px-1.5 text-muted-foreground tabular-nums">
                                {columns[column.id].length}
                            </span>
                        </h4>
                        {columns[column.id].length === 0 && (
                            <p className="mt-2 rounded-lg border border-dashed px-2 py-6 text-center text-xs text-muted-foreground/70">
                                Chưa có việc
                            </p>
                        )}
                        <ul className="flex flex-col gap-1.5">
                            {columns[column.id].map((card) => (
                                <li
                                    key={card.key}
                                    ref={(element) => {
                                        if (element) {
                                            cardRefs.current.set(
                                                card.key,
                                                element,
                                            );
                                        } else {
                                            cardRefs.current.delete(card.key);
                                        }
                                    }}
                                    data-column={column.id}
                                    draggable
                                    onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed =
                                            'move';
                                        setDragKey(card.key);
                                    }}
                                    onDragEnd={() => {
                                        setDragKey(null);
                                        setOverColumn(null);
                                    }}
                                    className={cn(
                                        'cursor-grab active:cursor-grabbing',
                                        dragKey === card.key && 'opacity-40',
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => setOpen(card)}
                                        className="flex w-full flex-col gap-1 rounded-lg border bg-background px-2.5 py-2 text-left text-sm shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                                    >
                                        {(card.badge ||
                                            (column.id !== 'todo' &&
                                                !isMoved(card.key))) && (
                                            <span className="flex items-center gap-1.5">
                                                {card.badge && (
                                                    <span className="w-fit rounded-sm bg-primary/10 px-1.5 py-0.5 text-xs font-medium">
                                                        {card.badge}
                                                    </span>
                                                )}
                                                {/* * An agent picked this card up: the AI's logo shows which one. */}
                                                {column.id !== 'todo' &&
                                                    !isMoved(card.key) && (
                                                        <span
                                                            title={`${vendorLabel} đang nhận việc này`}
                                                            className="ml-auto"
                                                        >
                                                            <VendorBadge
                                                                vendorKey={
                                                                    vendorKey
                                                                }
                                                                fallback={
                                                                    vendorLabel
                                                                }
                                                                className="size-4 rounded-sm text-[9px]"
                                                            />
                                                        </span>
                                                    )}
                                            </span>
                                        )}
                                        <span className="line-clamp-3 break-words">
                                            {card.text}
                                        </span>
                                        {card.detail && (
                                            <span className="truncate font-mono text-xs text-muted-foreground">
                                                {card.detail}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
            <Dialog
                open={open !== null}
                onOpenChange={(value) => {
                    if (!value) {
                        setOpen(null);
                        setChatting(false);
                        setFeedback('');
                    }
                }}
            >
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="flex flex-wrap items-center gap-2">
                            {open?.badge && (
                                <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-xs font-medium">
                                    {open.badge}
                                </span>
                            )}
                            <span className="break-words">{open?.text}</span>
                        </DialogTitle>
                        <DialogDescription>
                            Việc này cần làm gì, theo plan hoặc theo agent đang
                            chạy.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-3 text-sm">
                        {open?.info.map((section) => (
                            <section
                                key={section.label}
                                className="flex flex-col gap-1"
                            >
                                <h4 className="text-xs font-medium text-muted-foreground">
                                    {section.label}
                                </h4>
                                {section.lines.length === 1 ? (
                                    <p className="break-words whitespace-pre-wrap">
                                        {section.lines[0]}
                                    </p>
                                ) : (
                                    <ul className="ml-4 flex list-disc flex-col gap-0.5">
                                        {section.lines.map((line, index) => (
                                            <li
                                                key={index}
                                                className="break-words"
                                            >
                                                {line}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        ))}
                    </div>
                    {open && onChatAbout && (
                        <div className="flex flex-col gap-2">
                            {chatting ? (
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={feedback}
                                        onChange={(event) =>
                                            setFeedback(event.target.value)
                                        }
                                        onKeyDown={(event) => {
                                            if (
                                                event.key === 'Enter' &&
                                                !event.nativeEvent.isComposing
                                            ) {
                                                event.preventDefault();
                                                sendFeedback();
                                            }
                                        }}
                                        aria-label="Nội dung cần sửa"
                                        placeholder="Muốn AI sửa gì ở việc này?"
                                        maxLength={500}
                                        autoFocus
                                        className="h-8"
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={sendFeedback}
                                        disabled={feedback.trim() === ''}
                                    >
                                        Gửi
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setChatting(true)}
                                    >
                                        <MessageSquare className="size-3.5" />
                                        Chat với AI để sửa
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
