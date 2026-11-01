import {
    ArrowUp,
    Bot,
    Check,
    ChevronDown,
    ListChecks,
    Paperclip,
    Wand2,
    X,
    Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { RepoPicker } from '@/components/ai-chat/repo-picker';
import { SourceIcon } from '@/components/ai-chat/source-icon';
import { VendorBadge } from '@/components/ai-chat/vendor-badge';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
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
    AiChatAccount,
    AiChatMode,
    AiChatSelection,
} from '@/types';

/**
 * Rounded textarea + round send button. Custom (not the shared `Field`) because it needs Enter-to-send with Shift+Enter for a newline.
 */
export function ChatComposer({
    value,
    onChange,
    onSubmit,
    sending,
    agents,
    maxLength,
    autoFocus = false,
    accounts,
    selection,
    onSelectionChange,
    files,
    onFilesChange,
    acceptedExtensions,
    maxFiles,
    repo,
    onRepoChange,
    extraRepos,
    onExtraReposChange,
    githubConnected,
    onOptimize,
    optimizing,
    mode,
    onModeChange,
    onUndoOptimize,
}: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    sending: boolean;
    /** * Agents working right now (every chat of the page): shown as a count, listed in a popover. */
    agents: AiAgentRun[];
    maxLength: number;
    autoFocus?: boolean;
    /** * Enabled AI accounts the person can pick to answer (Claude, Codex, ...). */
    accounts: AiChatAccount[];
    selection: AiChatSelection;
    onSelectionChange: (selection: AiChatSelection) => void;
    /** * Files attached to the next message (read by the server for that turn only). */
    files: File[];
    onFilesChange: (files: File[]) => void;
    acceptedExtensions: string[];
    maxFiles: number;
    /** * `owner/name` of the GitHub repo the AI may read, or null. */
    repo: string | null;
    onRepoChange: (repo: string | null) => void;
    extraRepos: string[];
    onExtraReposChange: (extras: string[]) => void;
    githubConnected: boolean;
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
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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

    const picked = accounts.find(
        (account) => account.id === selection.accountId,
    );
    const pickedLabel = picked
        ? (picked.models.find((model) => model.id === selection.model)?.label ??
          selection.model ??
          picked.name)
        : '';

    const submit = (event?: FormEvent) => {
        event?.preventDefault();

        if (sending || value.trim() === '') {
            return;
        }

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
    const pickedProjects = repo === null ? [] : [repo, ...extraRepos];

    return (
        <div className="relative flex flex-col gap-2">
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
                            className="flex max-w-56 items-center gap-1.5 rounded-lg bg-muted py-1 pr-1 pl-2 text-xs"
                        >
                            <SourceIcon
                                local={local}
                                className="text-muted-foreground"
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
                                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                                <X aria-hidden="true" className="size-3" />
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
            <form
                onSubmit={submit}
                className="flex flex-col gap-1 rounded-2xl border border-input bg-card px-3 pt-3 pb-2 shadow-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
            >
                {files.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5 px-1">
                        {files.map((file, index) => (
                            <li
                                key={`${file.name}-${index}`}
                                className="flex max-w-48 items-center gap-1 rounded-md bg-muted py-0.5 pr-1 pl-2 text-xs"
                            >
                                <span className="truncate">{file.name}</span>
                                <button
                                    type="button"
                                    aria-label={`Bỏ tệp ${file.name}`}
                                    onClick={() =>
                                        onFilesChange(
                                            files.filter((_, i) => i !== index),
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
                    disabled={busy}
                    aria-label="Nhắn tin cho trợ lý AI"
                    placeholder="Nhắn tin cho trợ lý AI"
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
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busy || files.length >= maxFiles}
                        aria-label="Đính kèm tệp"
                        title={`Đính kèm tệp (tối đa ${maxFiles})`}
                        onClick={() => fileInputRef.current?.click()}
                        className="size-8 text-muted-foreground"
                    >
                        <Paperclip aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy || value.trim() === ''}
                        aria-label="Tối ưu prompt"
                        title="Viết lại cho rõ ràng hơn (bạn xem rồi mới gửi)"
                        onClick={onOptimize}
                        className="h-8 gap-1.5 px-2 text-muted-foreground"
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
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={
                                        agents.length === 0
                                            ? 'Agent: đang rảnh'
                                            : `${agents.length} agent đang làm việc`
                                    }
                                    className="h-8 shrink-0 gap-1.5 px-2 text-muted-foreground"
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
                            </PopoverTrigger>
                            <PopoverContent
                                align="end"
                                className="w-80 p-2"
                                aria-label="Agent đang làm việc"
                            >
                                {agents.length === 0 ? (
                                    <p className="px-2 py-1.5 text-sm text-muted-foreground">
                                        Chưa có agent nào đang làm việc.
                                    </p>
                                ) : (
                                    <ul className="flex flex-col gap-1">
                                        {agents.map((agent) => (
                                            <li
                                                key={agent.id}
                                                className="flex flex-col gap-0.5 rounded-lg px-2 py-1.5 text-sm"
                                            >
                                                <span className="flex items-center gap-2">
                                                    <span
                                                        aria-hidden="true"
                                                        className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none"
                                                    />
                                                    <span className="truncate font-medium">
                                                        {agent.name}
                                                    </span>
                                                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                                                        {Math.max(
                                                            0,
                                                            Math.floor(
                                                                (now -
                                                                    agent.startedAt) /
                                                                    1000,
                                                            ),
                                                        )}
                                                        s
                                                    </span>
                                                </span>
                                                <span className="truncate text-xs text-muted-foreground">
                                                    {agent.step}
                                                </span>
                                                <span className="truncate text-xs text-muted-foreground/80">
                                                    {agent.task}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </PopoverContent>
                        </Popover>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    aria-label="Chọn chế độ"
                                    className="h-8 shrink-0 gap-1.5 px-2 text-muted-foreground"
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
                                        Plan: lập kế hoạch, chưa làm
                                    </span>
                                    {mode === 'plan' && (
                                        <Check aria-hidden="true" />
                                    )}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {picked && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={busy}
                                        aria-label="Chọn AI trả lời"
                                        className="h-8 shrink-0 gap-2 px-2 text-muted-foreground"
                                    >
                                        <VendorBadge
                                            vendorKey={picked.vendor_key}
                                            fallback={picked.vendor}
                                            className="size-5 rounded text-[10px]"
                                        />
                                        <span className="max-w-32 truncate">
                                            {pickedLabel}
                                        </span>
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
                                                {account.name}
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
                        <Button
                            type="submit"
                            size="icon"
                            className="size-8 shrink-0 rounded-full"
                            disabled={busy || value.trim() === ''}
                            aria-label="Gửi tin nhắn"
                        >
                            <ArrowUp aria-hidden="true" />
                        </Button>
                    </div>
                </div>
            </form>
        </div>
    );
}
