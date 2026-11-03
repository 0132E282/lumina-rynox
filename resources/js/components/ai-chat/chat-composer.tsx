import {
    ArrowUp,
    Bot,
    Check,
    ChevronDown,
    FileCode,
    ListChecks,
    ListPlus,
    Mic,
    Volume2,
    Paperclip,
    Plus,
    Square,
    Wand2,
    X,
    Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSpeechInput } from '@/hooks/use-speech-input';
import { canSpeak, setAutoRead, useSpeech } from '@/lib/speak';
import type { FormEvent, KeyboardEvent } from 'react';
import { AttachmentTile } from '@/components/ai-chat/attachment-tile';
import { RepoPicker } from '@/components/ai-chat/repo-picker';
import { planRunMessage } from '@/lib/project-plans';
import { useProjectPlans } from '@/hooks/use-project-plans';
import { SubagentTree } from '@/components/ai-chat/subagent-tree';
import { TaskBoard } from '@/components/ai-chat/task-board';
import { SourceIcon } from '@/components/ai-chat/source-icon';
import { VendorBadge } from '@/components/ai-chat/vendor-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    referenceLabel,
    referenceLines,
    takeCopied,
} from '@/lib/code-reference';
import type { CodeReference } from '@/lib/code-reference';
import { matchCommands } from '@/lib/ai-commands';
import type { AiCommand } from '@/lib/ai-commands';
import { cn } from '@/lib/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
    AiAgentRun,
    AiChatProposal,
    AiPlanItem,
    AiSubagent,
    AiChatAccount,
    AiChatMode,
    AiChatSelection,
} from '@/types';

// * A generated account name ends with the token type ("OpenAI / Codex · Session token"): the picker shows just the provider ("OpenAI").
const accountLabel = (account: AiChatAccount) =>
    account.name
        .replace(/ · (?:API token|Session token)(?: \d+)?$/, '')
        .replace(/^OpenAI \/ Codex$/, 'OpenAI');

/** * Green while the account has quota, red once its last call stopped on the quota. */
function QuotaDot({ account }: { account: AiChatAccount }) {
    const out = account.out_of_quota === true;

    return (
        <span
            role="img"
            aria-label={out ? 'Hết token' : 'Còn token'}
            title={out ? 'Hết token' : 'Còn token'}
            className={cn(
                'size-2 shrink-0 rounded-full',
                out ? 'bg-red-500' : 'bg-green-500',
            )}
        />
    );
}

/**
 * Rounded textarea + round send button. Custom (not the shared `Field`) because it needs Enter-to-send with Shift+Enter for a newline.
 */
export function ChatComposer({
    value,
    onChange,
    onSubmit,
    queued = [],
    onRemoveQueued,
    onStop,
    sending,
    agents,
    maxLength,
    autoFocus = false,
    accounts,
    selection,
    onSelectionChange,
    files,
    onFilesChange,
    references = [],
    onReferencesChange,
    proposals = [],
    onSendMessage,
    subagents = [],
    plan = [],
    acceptedExtensions,
    maxFiles,
    repo,
    onRepoChange,
    extraRepos,
    onExtraReposChange,
    githubConnected,
    showProjects = true,
    onOptimize,
    optimizing,
    mode,
    onModeChange,
    focusSignal,
    onUndoOptimize,
}: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    /** * Stops the answer being waited for: the send button turns into a stop button while sending. */
    onStop: () => void;
    /** * Messages waiting for the current answer to finish. */
    queued?: { id: string; text: string }[];
    onRemoveQueued?: (id: string) => void;
    sending: boolean;
    /** * Agents working right now (every chat of the page): shown as a count, listed in a popover. */
    agents: AiAgentRun[];
    /** * Subagents the AI started for the current answer, shown under the main agent as a tree. */
    /** * File changes the AI proposed in this chat: a plan it wrote into docs/plans shows on the board before the project has the file. */
    proposals?: AiChatProposal[];
    /** * Sends a message of its own (the draft stays): "Bắt đầu" on the board hands a plan to the AI. */
    onSendMessage?: (message: string) => void;
    subagents?: AiSubagent[];
    /** * The plan the AI keeps for the current answer: with the subagents it fills the board. */
    plan?: AiPlanItem[];
    maxLength: number;
    autoFocus?: boolean;
    /** * Enabled AI accounts the person can pick to answer (Claude, Codex, ...). */
    accounts: AiChatAccount[];
    selection: AiChatSelection;
    onSelectionChange: (selection: AiChatSelection) => void;
    /** * Files attached to the next message (read by the server for that turn only). */
    files: File[];
    onFilesChange: (files: File[]) => void;
    /** * Code picked in the viewer, shown as tags above the text. */
    references?: CodeReference[];
    onReferencesChange?: (references: CodeReference[]) => void;
    acceptedExtensions: string[];
    maxFiles: number;
    /** * `owner/name` of the GitHub repo the AI may read, or null. */
    repo: string | null;
    onRepoChange: (repo: string | null) => void;
    extraRepos: string[];
    onExtraReposChange: (extras: string[]) => void;
    githubConnected: boolean;
    /** * The project row (picked projects and the picker) shows on the Code tab only. */
    showProjects?: boolean;
    onOptimize: () => void;
    optimizing: boolean;
    /** * Open the pull request for AI edits without a manual approval. */
    autoPr: boolean;
    onAutoPrChange: (value: boolean) => void;
    /** * "auto" answers normally; "plan" asks the AI for a step-by-step plan only (the server adds the fixed instruction). */
    mode: AiChatMode;
    onModeChange: (mode: AiChatMode) => void;
    /** * Set after "Tối ưu" rewrote the draft: restores the draft as it was. */
    onUndoOptimize?: () => void;
    /** * Changes when something outside put text in the draft: the cursor goes to its end. */
    focusSignal?: number;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const field = textareaRef.current;

        if (focusSignal !== undefined && field) {
            field.focus();
            field.setSelectionRange(field.value.length, field.value.length);
        }
    }, [focusSignal]);

    useEffect(() => {
        if (autoFocus) {
            textareaRef.current?.focus();
        }
    }, [autoFocus]);

    // * Focus comes back after an answer arrives, so the next question can be typed straight away.
    useEffect(() => {
        if (!sending && !optimizing) {
            textareaRef.current?.focus();
        }
    }, [sending, optimizing]);

    // * Ticks every second while an agent works, so the times in the list keep moving.
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (agents.length === 0) {
            return;
        }

        setNow(Date.now());

        const timer = window.setInterval(() => setNow(Date.now()), 1000);

        return () => window.clearInterval(timer);
    }, [agents.length]);

    // * The agent list opens only when the person presses the Agent button.
    const [agentsOpen, setAgentsOpen] = useState(false);
    const panelRef = useRef<HTMLElement>(null);

    // * The panel closes on a click outside it (the Agent button toggles it itself) and on Escape.
    useEffect(() => {
        if (!agentsOpen) {
            return;
        }

        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null;

            // * A popup is open (its dark backdrop is "outside" too): that click only closes the popup, never the panel under it.
            if (document.querySelector('[role="dialog"], [role="listbox"]')) {
                return;
            }

            // * Menus and popups opened from inside the panel live in portals outside it: a click in them is not "outside".
            if (
                !panelRef.current?.contains(target) &&
                !target?.closest(
                    '[data-agent-toggle], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper]',
                )
            ) {
                setAgentsOpen(false);
            }
        };
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            // * Escape closes an open popup or menu first, not the panel under it.
            if (
                event.key === 'Escape' &&
                !document.querySelector('[role="dialog"], [role="listbox"]')
            ) {
                setAgentsOpen(false);
            }
        };

        // * Capture phase: the check runs before the popup's own handler closes it, so an open popup is still seen as open.
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);

        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [agentsOpen]);
    useEffect(() => {
        // * Plan mode only exists inside a project: leaving it for a general chat goes back to Auto.
        if (repo === null && mode === 'plan') {
            onModeChange('auto');
        }
    }, [repo, mode, onModeChange]);
    const projectPlans = useProjectPlans(repo, agentsOpen, proposals);
    const [agentTab, setAgentTab] = useState<'kanban' | 'diagram'>('kanban');
    // * The panel sits in the middle of the chat column: centred on the composer's width, and on the window's height.
    const rootRef = useRef<HTMLDivElement>(null);
    const [panelCenter, setPanelCenter] = useState({ x: 0, width: 640 });

    useEffect(() => {
        const place = () => {
            const rect = rootRef.current?.getBoundingClientRect();

            if (rect) {
                // * Wider than the chat column (the board has three columns), but never off the window.
                const width = Math.min(1680, window.innerWidth - 24);

                setPanelCenter({
                    x: Math.min(
                        Math.max(rect.left + rect.width / 2, width / 2 + 12),
                        window.innerWidth - width / 2 - 12,
                    ),
                    width,
                });
            }
        };

        if (agentsOpen) {
            place();
            window.addEventListener('resize', place);
        }

        return () => window.removeEventListener('resize', place);
    }, [agentsOpen]);

    const picked = accounts.find(
        (account) => account.id === selection.accountId,
    );
    const pickedLabel = picked
        ? (picked.models.find((model) => model.id === selection.model)?.label ??
          selection.model ??
          picked.name)
        : '';

    // * A message may be only tags (picked code) without typed text.
    const empty = value.trim() === '' && references.length === 0;
    const { auto: autoRead } = useSpeech();
    // * Voice dictation: each phrase is added to the end of the message.
    const valueRef = useRef(value);

    valueRef.current = value;
    const voice = useSpeechInput((text) => {
        if (text !== '') {
            const current = valueRef.current;

            onChange(
                `${current}${current === '' || /\s$/.test(current) ? '' : ' '}${text}`,
            );
        }
    });

    const submit = (event?: FormEvent) => {
        event?.preventDefault();

        if (empty) {
            return;
        }

        voice.stop();
        onSubmit();
    };

    // * Typing "/" offers the ready-made prompt templates; picking one fills the draft for the person to edit.
    const commands = matchCommands(value);
    const [highlight, setHighlight] = useState(0);
    const [menuDismissed, setMenuDismissed] = useState(false);
    const menuOpen = commands !== null && commands.length > 0 && !menuDismissed;
    const active = menuOpen ? Math.min(highlight, commands.length - 1) : 0;

    const pickCommand = (command: AiCommand) => {
        onChange(command.template);
        setHighlight(0);
        textareaRef.current?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (menuOpen && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlight(
                    (active +
                        (event.key === 'ArrowDown' ? 1 : -1) +
                        commands.length) %
                        commands.length,
                );

                return;
            }

            if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                pickCommand(commands[active]);

                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                setMenuDismissed(true);

                return;
            }
        }

        // * `isComposing` keeps Enter from sending while an IME (Vietnamese Telex/VNI) is still composing.
        if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
        ) {
            event.preventDefault();
            submit();
        }
    };

    const busy = sending || optimizing;
    const [projectTitle, setProjectTitle] = useState('');
    // * Narrow chat: the project chips fold into one menu, whose "Thêm dự án" opens the picker dialog.
    const [pickerOpen, setPickerOpen] = useState(false);
    const pickedProjects = repo === null ? [] : [repo, ...extraRepos];

    return (
        <div ref={rootRef} className="@container relative flex flex-col gap-2">
            {/* * Big panel in the middle of the chat while an AI works: who is running, what step, and what the app read for it. Opens by itself; the person can close it. */}
            {agentsOpen && repo !== null && (
                <section
                    ref={panelRef}
                    aria-label="Agent đang làm việc"
                    style={{ left: panelCenter.x, width: panelCenter.width }}
                    className="fixed top-[calc(50%-3rem)] z-50 flex h-[min(56rem,calc(100vh-11rem))] -translate-x-1/2 -translate-y-1/2 animate-in flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl fade-in-0 zoom-in-95 motion-reduce:animate-none"
                >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
                        <h2 className="flex items-center gap-2 text-sm font-medium">
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'size-2 rounded-full',
                                    agents.length > 0
                                        ? 'animate-pulse bg-emerald-500 motion-reduce:animate-none'
                                        : 'bg-muted-foreground/40',
                                )}
                            />
                            {agents.length === 0
                                ? 'Chưa có agent nào đang làm việc'
                                : `${agents.length} agent đang chạy`}
                        </h2>
                        <Tabs
                            value={agentTab}
                            onValueChange={(value) =>
                                setAgentTab(value as 'kanban' | 'diagram')
                            }
                            className="ml-auto"
                        >
                            <TabsList className="h-8">
                                <TabsTrigger
                                    value="kanban"
                                    className="px-3 text-sm"
                                >
                                    Kanban
                                </TabsTrigger>
                                <TabsTrigger
                                    value="diagram"
                                    className="px-3 text-sm"
                                >
                                    Sơ đồ agent
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Đóng"
                            onClick={() => setAgentsOpen(false)}
                            className="size-7 text-muted-foreground"
                        >
                            <X aria-hidden="true" />
                        </Button>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                        {agentTab === 'diagram' && (
                            <SubagentTree
                                subagents={subagents}
                                rootName={
                                    agents[0]?.name || picked?.name || 'AI'
                                }
                                working={agents.length > 0}
                                vendorKey={picked?.vendor_key ?? ''}
                                vendorLabel={picked?.vendor ?? 'AI'}
                                now={now}
                            />
                        )}
                        {agentTab === 'kanban' && (
                            <TaskBoard
                                plan={plan}
                                subagents={subagents}
                                projectPlans={projectPlans.plans}
                                selectedPlan={projectPlans.selected}
                                onSelectPlan={projectPlans.setSelected}
                                projectTasks={projectPlans.tasks}
                                planError={projectPlans.error}
                                startDisabled={sending}
                                vendorKey={picked?.vendor_key ?? ''}
                                vendorLabel={picked?.vendor ?? 'AI'}
                                onChatAbout={(card, feedback) => {
                                    const message = `Sửa ${card.badge ? `${card.badge}: ` : ''}${card.text}\nFeedback: ${feedback}`;

                                    if (onSendMessage) {
                                        onSendMessage(message);
                                    } else {
                                        onChange(message);
                                    }

                                    setAgentsOpen(false);
                                }}
                                onStartPlan={
                                    onSendMessage && projectPlans.selected
                                        ? () => {
                                              onSendMessage(
                                                  planRunMessage(
                                                      projectPlans.selected!,
                                                      projectPlans.tasks.filter(
                                                          (task) =>
                                                              task.status !==
                                                              'done',
                                                      ),
                                                  ),
                                              );
                                              setAgentsOpen(false);
                                          }
                                        : undefined
                                }
                            />
                        )}
                    </div>
                </section>
            )}
            {menuOpen && (
                <ul
                    id="ai-command-list"
                    role="listbox"
                    aria-label="Mẫu prompt dựng sẵn"
                    className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
                >
                    {commands.map((command, index) => (
                        <li
                            key={command.name}
                            id={`ai-command-${index}`}
                            role="option"
                            aria-selected={index === active}
                            onMouseDown={(event) => {
                                // * Keeps the textarea focused while picking.
                                event.preventDefault();
                                pickCommand(command);
                            }}
                            onMouseEnter={() => setHighlight(index)}
                            className={cn(
                                'flex cursor-pointer items-baseline gap-3 rounded-md px-3 py-2 text-sm',
                                index === active &&
                                    'bg-accent text-accent-foreground',
                            )}
                        >
                            <span className="font-medium">/{command.name}</span>
                            <span className="truncate text-muted-foreground">
                                {command.description}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {showProjects && (
                <div className="@max-lg:hidden">
                    <ul
                        aria-label="Dự án đã chọn"
                        className="flex flex-wrap gap-1.5 px-1"
                    >
                        {repo !== null && projectTitle !== '' && (
                            <li className="max-w-56 truncate px-1 py-1 text-xs font-medium">
                                {projectTitle}
                            </li>
                        )}
                        {pickedProjects.map((id) => {
                            const local = id.startsWith('local:');
                            const name = local ? id.slice(6) : id;

                            return (
                                <li
                                    key={id}
                                    title={name}
                                    className="flex max-w-72 items-center gap-2 rounded-lg border bg-muted py-1.5 pr-1.5 pl-2.5 text-sm font-medium"
                                >
                                    <SourceIcon
                                        local={local}
                                        className="text-foreground/70"
                                    />
                                    <span className="truncate">
                                        {name.split('/').pop()}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={`Bỏ dự án ${name}`}
                                        disabled={busy}
                                        onClick={() => {
                                            const rest = pickedProjects.filter(
                                                (item) => item !== id,
                                            );

                                            onRepoChange(rest[0] ?? null);
                                            if (rest.length === 0) {
                                                setProjectTitle('');
                                            }
                                            onExtraReposChange(rest.slice(1));
                                        }}
                                        className="rounded-sm p-0.5 text-foreground/60 hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    >
                                        <X
                                            aria-hidden="true"
                                            className="size-3.5"
                                        />
                                    </button>
                                </li>
                            );
                        })}
                        <li>
                            <RepoPicker
                                projectTitle={projectTitle}
                                onProjectTitleChange={setProjectTitle}
                                compact
                                repo={repo}
                                onChange={onRepoChange}
                                extras={extraRepos}
                                onExtrasChange={onExtraReposChange}
                                connected={githubConnected}
                                disabled={busy}
                            />
                        </li>
                    </ul>
                </div>
            )}
            {showProjects && (
                <div className="hidden @max-lg:block">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                aria-label="Thêm dự án"
                                className="h-9 w-full justify-start gap-1.5 border border-border/60 bg-muted/40 px-3 text-muted-foreground hover:bg-muted/70"
                            >
                                <SourceIcon
                                    local={repo?.startsWith('local:') === true}
                                />
                                <span className="min-w-0 flex-1 truncate text-left">
                                    {pickedProjects.length === 0
                                        ? 'Thêm dự án'
                                        : projectTitle ||
                                          (pickedProjects[0]
                                              .replace(/^local:/, '')
                                              .split('/')
                                              .pop() ??
                                              'Dự án')}
                                    {pickedProjects.length > 1 &&
                                        ` +${pickedProjects.length - 1}`}
                                </span>
                                <ChevronDown
                                    aria-hidden="true"
                                    className="size-3.5 shrink-0"
                                />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="start"
                            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
                        >
                            {pickedProjects.map((id) => (
                                <DropdownMenuItem
                                    key={id}
                                    onSelect={() => {
                                        const rest = pickedProjects.filter(
                                            (item) => item !== id,
                                        );

                                        onRepoChange(rest[0] ?? null);
                                        if (rest.length === 0) {
                                            setProjectTitle('');
                                        }
                                        onExtraReposChange(rest.slice(1));
                                    }}
                                >
                                    <X aria-hidden="true" />
                                    <span className="truncate">
                                        Bỏ {id.replace(/^local:/, '')}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                            {pickedProjects.length > 0 && (
                                <DropdownMenuSeparator />
                            )}
                            <DropdownMenuItem
                                onSelect={() => setPickerOpen(true)}
                            >
                                <Plus aria-hidden="true" />
                                {pickedProjects.length === 0
                                    ? 'Chọn dự án'
                                    : 'Thêm dự án'}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <RepoPicker
                        open={pickerOpen}
                        onOpenChange={setPickerOpen}
                        projectTitle={projectTitle}
                        onProjectTitleChange={setProjectTitle}
                        repo={repo}
                        onChange={onRepoChange}
                        extras={extraRepos}
                        onExtrasChange={onExtraReposChange}
                        connected={githubConnected}
                        disabled={busy}
                    />
                </div>
            )}
            <form
                onSubmit={submit}
                className="@container flex flex-col gap-1 rounded-2xl border border-input bg-card px-3 pt-3 pb-2 shadow-sm dark:bg-input/30"
            >
                {queued.length > 0 && (
                    <ul
                        aria-label="Tin đang chờ gửi"
                        className="flex flex-col gap-1 px-1 pb-1"
                    >
                        {queued.map((item, index) => (
                            <li
                                key={item.id}
                                className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/50 py-1 pr-1 pl-2.5 text-xs text-muted-foreground"
                            >
                                <span className="shrink-0 tabular-nums">
                                    Chờ {index + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-foreground">
                                    {item.text}
                                </span>
                                <button
                                    type="button"
                                    aria-label="Bỏ tin đang chờ"
                                    onClick={() => onRemoveQueued?.(item.id)}
                                    className="rounded-sm p-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <X aria-hidden="true" className="size-3" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {files.length > 0 && (
                    <ul
                        aria-label="Tệp đính kèm"
                        className="flex flex-wrap gap-2 px-1 pb-1"
                    >
                        {files.map((file, index) => (
                            <AttachmentTile
                                key={`${file.name}-${file.size}-${index}`}
                                file={file}
                                onRemove={() =>
                                    onFilesChange(
                                        files.filter((_, i) => i !== index),
                                    )
                                }
                            />
                        ))}
                    </ul>
                )}
                {references.length > 0 && (
                    <ul
                        aria-label="Đoạn code đã chọn"
                        className="flex flex-wrap gap-1.5 px-1"
                    >
                        {references.map((reference, index) => (
                            <li
                                key={`${reference.path}:${reference.startLine}-${reference.endLine}-${index}`}
                                title={`${reference.path}:${referenceLines(reference)}`}
                                className="flex max-w-60 items-center gap-1 rounded-md border bg-muted py-0.5 pr-1 pl-1.5 text-xs"
                            >
                                <FileCode
                                    aria-hidden="true"
                                    className="size-3.5 shrink-0 text-muted-foreground"
                                />
                                <span className="truncate font-medium">
                                    {referenceLabel(reference)}
                                </span>
                                <button
                                    type="button"
                                    aria-label={`Bỏ ${referenceLabel(reference)}`}
                                    onClick={() =>
                                        onReferencesChange?.(
                                            references.filter(
                                                (_, i) => i !== index,
                                            ),
                                        )
                                    }
                                    className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <X aria-hidden="true" className="size-3" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <textarea
                    ref={textareaRef}
                    onPaste={(event) => {
                        // * A picture on the clipboard (a screenshot, a copied image) joins the attachments.
                        const images = Array.from(
                            event.clipboardData.files,
                        ).filter((file) => file.type.startsWith('image/'));

                        if (images.length > 0) {
                            event.preventDefault();
                            onFilesChange(
                                [
                                    ...files,
                                    ...images.map(
                                        (file, index) =>
                                            new File(
                                                [file],
                                                `anh-dan-${Date.now()}-${index}.${file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'}`,
                                                { type: file.type },
                                            ),
                                    ),
                                ].slice(0, maxFiles),
                            );

                            return;
                        }

                        // * Lines copied from the code viewer become a tag (file and lines) instead of the code text.
                        const reference = takeCopied(
                            event.clipboardData.getData('text'),
                        );

                        if (reference !== null && onReferencesChange) {
                            event.preventDefault();
                            onReferencesChange([...references, reference]);
                        }
                    }}
                    value={value}
                    onChange={(event) => {
                        setMenuDismissed(false);
                        setHighlight(0);
                        onChange(event.target.value);
                    }}
                    role="combobox"
                    aria-expanded={menuOpen}
                    aria-controls="ai-command-list"
                    aria-autocomplete="list"
                    aria-activedescendant={
                        menuOpen ? `ai-command-${active}` : undefined
                    }
                    onKeyDown={handleKeyDown}
                    rows={1}
                    maxLength={maxLength}
                    disabled={optimizing}
                    aria-label="Nhắn tin cho trợ lý AI"
                    placeholder={
                        sending
                            ? 'Nhắn tiếp: tin sẽ được gửi sau khi AI trả lời xong'
                            : 'Nhắn tin cho trợ lý AI'
                    }
                    className="[field-sizing:content] max-h-48 min-h-8 w-full resize-none bg-transparent px-1 py-1 text-base outline-none placeholder:text-muted-foreground disabled:opacity-60 md:text-sm"
                />
                <div className="flex flex-wrap items-center gap-1">
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        hidden
                        accept={acceptedExtensions
                            .map((extension) => `.${extension}`)
                            .join(',')}
                        onChange={(event) => {
                            const picked = Array.from(event.target.files ?? []);

                            event.target.value = '';
                            onFilesChange(
                                [...files, ...picked].slice(0, maxFiles),
                            );
                        }}
                    />
                    {/* * A narrow chat folds the toolbar into this one menu. */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={busy}
                                aria-label="Thêm tùy chọn"
                                className="invisible w-0 overflow-hidden px-0 text-muted-foreground opacity-0 transition-[width,opacity] duration-200 motion-reduce:transition-none @max-2xl:visible @max-2xl:w-8 @max-2xl:opacity-100"
                            >
                                <Plus aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-56">
                            <DropdownMenuItem
                                disabled={files.length >= maxFiles}
                                onSelect={() => fileInputRef.current?.click()}
                            >
                                <Paperclip aria-hidden="true" />
                                Đính kèm tệp
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={value.trim() === ''}
                                onSelect={onOptimize}
                            >
                                <Wand2 aria-hidden="true" />
                                Tối ưu
                            </DropdownMenuItem>
                            {/* * Auto/Plan only matter inside a project (the Code tab). */}
                            {repo !== null && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onSelect={() => onModeChange('auto')}
                                        className="justify-between gap-2"
                                    >
                                        <span className="flex items-center gap-2">
                                            <Zap aria-hidden="true" />
                                            Auto
                                        </span>
                                        {mode === 'auto' && (
                                            <Check aria-hidden="true" />
                                        )}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() => onModeChange('plan')}
                                        className="justify-between gap-2"
                                    >
                                        <span className="flex items-center gap-2">
                                            <ListChecks aria-hidden="true" />
                                            Plan
                                        </span>
                                        {mode === 'plan' && (
                                            <Check aria-hidden="true" />
                                        )}
                                    </DropdownMenuItem>
                                </>
                            )}
                            {accounts.map((account) => (
                                <div key={account.id}>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                        {accountLabel(account)}
                                        <QuotaDot account={account} />
                                    </DropdownMenuLabel>
                                    {(account.models.length > 0
                                        ? account.models
                                        : [{ id: '', label: account.name }]
                                    ).map((model) => {
                                        const modelId = model.id || null;
                                        const isSelected =
                                            account.id ===
                                                selection.accountId &&
                                            modelId === selection.model;

                                        return (
                                            <DropdownMenuItem
                                                key={model.id}
                                                onSelect={() =>
                                                    onSelectionChange({
                                                        accountId: account.id,
                                                        model: modelId,
                                                    })
                                                }
                                                className="justify-between gap-2"
                                            >
                                                <span className="truncate">
                                                    {model.label}
                                                </span>
                                                {isSelected && (
                                                    <Check aria-hidden="true" />
                                                )}
                                            </DropdownMenuItem>
                                        );
                                    })}
                                </div>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busy || files.length >= maxFiles}
                        aria-label="Đính kèm tệp"
                        title={`Đính kèm tệp (tối đa ${maxFiles})`}
                        onClick={() => fileInputRef.current?.click()}
                        className="size-8 overflow-hidden text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-2xl:invisible @max-2xl:w-0 @max-2xl:px-0 @max-2xl:opacity-0"
                    >
                        <Paperclip aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy || empty}
                        aria-label="Tối ưu prompt"
                        title="Viết lại cho rõ ràng hơn (bạn xem rồi mới gửi)"
                        onClick={onOptimize}
                        className="h-8 gap-1.5 overflow-hidden px-2 text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-2xl:invisible @max-2xl:w-0 @max-2xl:px-0 @max-2xl:opacity-0"
                    >
                        <Wand2 aria-hidden="true" />
                        {optimizing ? 'Đang tối ưu...' : 'Tối ưu'}
                    </Button>
                    {onUndoOptimize && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={onUndoOptimize}
                            className="h-8 px-2 text-muted-foreground"
                        >
                            Hoàn tác
                        </Button>
                    )}
                    <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
                        {/* * Agent and Plan belong to the Code tab only. */}
                        {repo !== null && (
                            <>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    aria-expanded={agentsOpen}
                                    data-agent-toggle=""
                                    onClick={() =>
                                        setAgentsOpen((open) => !open)
                                    }
                                    size="sm"
                                    aria-label={
                                        agents.length === 0
                                            ? 'Agent: đang rảnh'
                                            : `${agents.length} agent đang làm việc`
                                    }
                                    className="h-8 shrink-0 gap-1.5 overflow-hidden px-2 text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-2xl:invisible @max-2xl:w-0 @max-2xl:px-0 @max-2xl:opacity-0"
                                >
                                    <Bot aria-hidden="true" />
                                    {agents.length === 0 ? (
                                        'Agent'
                                    ) : (
                                        <>
                                            <span
                                                aria-hidden="true"
                                                className="size-1.5 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none"
                                            />
                                            {agents.length} agent
                                        </>
                                    )}
                                </Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            disabled={busy}
                                            aria-label="Chọn chế độ"
                                            className="h-8 shrink-0 gap-1.5 overflow-hidden px-2 text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-2xl:invisible @max-2xl:w-0 @max-2xl:px-0 @max-2xl:opacity-0"
                                        >
                                            {mode === 'plan' ? (
                                                <ListChecks aria-hidden="true" />
                                            ) : (
                                                <Zap aria-hidden="true" />
                                            )}
                                            {mode === 'plan' ? 'Plan' : 'Auto'}
                                            <ChevronDown aria-hidden="true" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                        align="end"
                                        className="min-w-56"
                                    >
                                        <DropdownMenuItem
                                            onSelect={() =>
                                                onModeChange('auto')
                                            }
                                            className="justify-between gap-2"
                                        >
                                            <span className="flex items-center gap-2">
                                                <Zap aria-hidden="true" />
                                                Auto
                                            </span>
                                            {mode === 'auto' && (
                                                <Check aria-hidden="true" />
                                            )}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onSelect={() =>
                                                onModeChange('plan')
                                            }
                                            className="justify-between gap-2"
                                        >
                                            <span className="flex items-center gap-2">
                                                <ListChecks aria-hidden="true" />
                                                Plan: lập kế hoạch, chưa làm
                                            </span>
                                            {mode === 'plan' && (
                                                <Check aria-hidden="true" />
                                            )}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </>
                        )}
                        {picked && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={busy}
                                        aria-label="Chọn AI trả lời"
                                        className="h-8 shrink-0 gap-2 overflow-hidden px-2 text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-2xl:invisible @max-2xl:w-0 @max-2xl:px-0 @max-2xl:opacity-0"
                                    >
                                        <VendorBadge
                                            vendorKey={picked.vendor_key}
                                            fallback={picked.vendor}
                                            className="size-5 rounded text-[10px]"
                                        />
                                        <span className="max-w-32 truncate">
                                            {pickedLabel}
                                        </span>
                                        <QuotaDot account={picked} />
                                        <ChevronDown aria-hidden="true" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="min-w-56"
                                >
                                    {accounts.map((account, index) => (
                                        <div key={account.id}>
                                            {index > 0 && (
                                                <DropdownMenuSeparator />
                                            )}
                                            <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                                <VendorBadge
                                                    vendorKey={
                                                        account.vendor_key
                                                    }
                                                    fallback={account.vendor}
                                                    className="size-4 rounded text-[9px]"
                                                />
                                                {accountLabel(account)}
                                                <QuotaDot account={account} />
                                            </DropdownMenuLabel>
                                            {(account.models.length > 0
                                                ? account.models
                                                : [
                                                      {
                                                          id: '',
                                                          label: account.name,
                                                      },
                                                  ]
                                            ).map((model) => {
                                                const modelId =
                                                    model.id || null;
                                                const isSelected =
                                                    account.id ===
                                                        selection.accountId &&
                                                    modelId === selection.model;

                                                return (
                                                    <DropdownMenuItem
                                                        key={model.id}
                                                        onSelect={() =>
                                                            onSelectionChange({
                                                                accountId:
                                                                    account.id,
                                                                model: modelId,
                                                            })
                                                        }
                                                        className="justify-between gap-2"
                                                    >
                                                        <span className="truncate">
                                                            {model.label}
                                                        </span>
                                                        {isSelected && (
                                                            <Check aria-hidden="true" />
                                                        )}
                                                    </DropdownMenuItem>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                        {canSpeak() && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-pressed={autoRead}
                                aria-label="Tự đọc to câu trả lời"
                                title={
                                    autoRead
                                        ? 'Đang tự đọc câu trả lời (bấm để tắt)'
                                        : 'Tự đọc to câu trả lời'
                                }
                                onClick={() => setAutoRead(!autoRead)}
                                className={cn(
                                    'size-8 shrink-0 rounded-full text-muted-foreground',
                                    autoRead &&
                                        'bg-accent text-accent-foreground',
                                )}
                            >
                                <Volume2 aria-hidden="true" />
                            </Button>
                        )}
                        {voice.supported && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={busy}
                                aria-pressed={voice.listening}
                                aria-label={
                                    voice.listening
                                        ? 'Dừng nói'
                                        : 'Nhập bằng giọng nói'
                                }
                                title={
                                    voice.listening
                                        ? 'Dừng nói'
                                        : 'Nhập bằng giọng nói'
                                }
                                onClick={voice.toggle}
                                className={cn(
                                    'size-8 shrink-0 rounded-full text-muted-foreground',
                                    voice.listening &&
                                        'animate-pulse bg-destructive/10 text-destructive motion-reduce:animate-none',
                                )}
                            >
                                <Mic aria-hidden="true" />
                            </Button>
                        )}
                        {sending && !empty && (
                            <Button
                                type="submit"
                                variant="ghost"
                                size="icon"
                                className="size-8 shrink-0 rounded-full text-muted-foreground"
                                aria-label="Xếp hàng gửi sau"
                                title="Xếp hàng: gửi sau khi AI trả lời xong (Enter)"
                            >
                                <ListPlus aria-hidden="true" />
                            </Button>
                        )}
                        {sending ? (
                            <Button
                                type="button"
                                size="icon"
                                onClick={onStop}
                                className="size-8 shrink-0 rounded-full"
                                aria-label="Dừng câu trả lời"
                                title="Dừng câu trả lời"
                            >
                                <Square
                                    aria-hidden="true"
                                    className="fill-current"
                                />
                            </Button>
                        ) : (
                            <Button
                                type="submit"
                                size="icon"
                                className="size-8 shrink-0 rounded-full"
                                disabled={busy || empty}
                                aria-label="Gửi tin nhắn"
                            >
                                <ArrowUp aria-hidden="true" />
                            </Button>
                        )}
                    </div>
                </div>
            </form>
        </div>
    );
}
