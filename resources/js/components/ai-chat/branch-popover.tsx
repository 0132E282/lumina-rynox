import { ExternalLink, GitBranch, Lock } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { SourceIcon } from '@/components/ai-chat/source-icon';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { useCachedRequest } from '@/hooks/use-cached-request';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type GithubBranches = {
    default: string;
    branches: { name: string; protected: boolean }[];
};

type LocalBranches = {
    git: boolean;
    current: string | null;
    branches: string[];
    worktrees: { name: string; branch: string | null; current: boolean }[];
};

const triggerClass =
    'h-8 max-w-40 min-w-8 gap-1.5 overflow-hidden px-2 text-xs text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-sm/chat:invisible @max-sm/chat:w-0 @max-sm/chat:px-0 @max-sm/chat:opacity-0';

/** * Name of the branch the person is on, shown next to the trigger icon. */
function BranchName({ name }: { name: string | null | undefined }) {
    return name ? <span className="truncate">{name}</span> : null;
}

function Heading({ children }: { children: ReactNode }) {
    return (
        <h3 className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
            {children}
        </h3>
    );
}

/** * GitHub icon of a repo: opens the repo's branches (a link to each branch on GitHub) and a link to the repo itself. Read-only. */
export function GithubBranchPopover({
    repo,
    branch = null,
    onSelectBranch,
}: {
    repo: string;
    /** * Branch the code viewer shows (null: the default one). */
    branch?: string | null;
    onSelectBranch?: (branch: string | null) => void;
}) {
    const { data, failed } = useGithubBranches(repo);
    const [open, setOpen] = useState(false);
    const viewed = branch ?? data?.default ?? null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Nhánh của ${repo}`}
                    title={`Nhánh của ${repo}${viewed ? ` · đang xem ${viewed}` : ''}`}
                    className={triggerClass}
                >
                    <SourceIcon local={false} />
                    <BranchName name={viewed} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1">
                <GithubBranchList
                    repo={repo}
                    data={data}
                    failed={failed}
                    viewed={viewed}
                    onSelect={
                        onSelectBranch &&
                        ((name) => {
                            onSelectBranch(
                                name === data?.default ? null : name,
                            );
                            setOpen(false);
                        })
                    }
                />
            </PopoverContent>
        </Popover>
    );
}

function useGithubBranches(repo: string) {
    return useCachedRequest<GithubBranches>(
        `branches:github:${repo}`,
        30_000,
        () =>
            api
                .get<GithubBranches>('/ai-chat/github/branches', {
                    params: { repo },
                })
                .then(({ data }) => data),
        true,
    );
}

function GithubBranchList({
    repo,
    data,
    failed,
    viewed,
    onSelect,
}: {
    repo: string;
    data: GithubBranches | null;
    failed: boolean;
    viewed: string | null;
    onSelect?: (name: string) => void;
}) {
    return (
        <div className="flex max-h-80 flex-col overflow-y-auto">
            <a
                href={`https://github.com/${repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
                <SourceIcon local={false} />
                <span className="min-w-0 flex-1 truncate">{repo}</span>
                <ExternalLink
                    aria-hidden="true"
                    className="size-3.5 text-muted-foreground"
                />
            </a>
            <Heading>Nhánh</Heading>
            {data === null ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                    {failed ? 'Không tải được danh sách nhánh.' : 'Đang tải...'}
                </p>
            ) : (
                data.branches.map((branch) => (
                    <button
                        key={branch.name}
                        type="button"
                        onClick={() => onSelect?.(branch.name)}
                        className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                            branch.name === viewed && 'bg-accent font-medium',
                        )}
                    >
                        <GitBranch
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate">
                            {branch.name}
                        </span>
                        {branch.name === viewed && (
                            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                đang xem
                            </span>
                        )}
                        {branch.name === data.default && (
                            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                mặc định
                            </span>
                        )}
                        {branch.protected && (
                            <Lock
                                aria-label="Nhánh được bảo vệ"
                                className="size-3 shrink-0 text-muted-foreground"
                            />
                        )}
                    </button>
                ))
            )}
        </div>
    );
}

/** * Branch icon of a folder on this machine: its local branches and git worktrees (names only). Read-only. */
export function LocalBranchPopover({ root }: { root: string }) {
    const { data, failed } = useLocalBranches(root);

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    aria-label="Nhánh và worktree"
                    title={`Nhánh và worktree của dự án${data?.current ? ` · đang ở ${data.current}` : ''}`}
                    className={triggerClass}
                >
                    <GitBranch aria-hidden="true" />
                    <BranchName name={data?.current} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1">
                <LocalBranchList data={data} failed={failed} />
            </PopoverContent>
        </Popover>
    );
}

function useLocalBranches(root: string) {
    return useCachedRequest<LocalBranches>(
        `branches:local:${root}`,
        10_000,
        () =>
            api
                .get<LocalBranches>('/ai-chat/local/branches', {
                    params: { root },
                })
                .then(({ data }) => data),
        true,
    );
}

function LocalBranchList({
    data,
    failed,
}: {
    data: LocalBranches | null;
    failed: boolean;
}) {
    if (data === null) {
        return (
            <p className="px-2 py-3 text-sm text-muted-foreground">
                {failed ? 'Không tải được danh sách nhánh.' : 'Đang tải...'}
            </p>
        );
    }

    if (!data.git) {
        return (
            <p className="px-2 py-3 text-sm text-muted-foreground">
                Thư mục này không phải repo git.
            </p>
        );
    }

    return (
        <div className="flex max-h-80 flex-col overflow-y-auto">
            <Heading>Nhánh</Heading>
            {data.branches.map((branch) => (
                <div
                    key={branch}
                    className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                        branch === data.current && 'bg-accent font-medium',
                    )}
                >
                    <GitBranch
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">{branch}</span>
                    {branch === data.current && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                            đang dùng
                        </span>
                    )}
                </div>
            ))}
            {data.worktrees.length > 1 && (
                <>
                    <Heading>Worktree</Heading>
                    {data.worktrees.map((tree) => (
                        <div
                            key={tree.name}
                            className={cn(
                                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                                tree.current && 'bg-accent font-medium',
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate">
                                {tree.name}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                                {tree.branch ?? 'detached'}
                            </span>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
}
