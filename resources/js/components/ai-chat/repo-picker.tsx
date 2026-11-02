import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { repos as reposRoute } from '@/actions/App/Http/Controllers/AiChatController';
import {
    LocalProjectDialog,
    localUnavailableReason,
} from '@/components/ai-chat/local-project-dialog';
import type {
    LocalProject,
    LocalProjectsChange,
    LocalRoot,
} from '@/components/ai-chat/local-project-dialog';
import { SourceIcon } from '@/components/ai-chat/source-icon';
import { Button } from '@/components/ui/button';
import { useCachedRequest } from '@/hooks/use-cached-request';
import { api } from '@/lib/api';
import { cachedRequest, invalidateAiChatCache } from '@/lib/ai-chat-cache';
import type { AiChatRepo } from '@/types';

const TTL_MS = 5 * 60 * 1000;

/** * Button under the chat box that opens the project dialog: tick GitHub repos and local folders to read together (the first is the main project). */
export function RepoPicker({
    repo,
    onChange,
    extras,
    onExtrasChange,
    connected,
    disabled,
    compact = false,
    projectTitle = '',
    onProjectTitleChange,
    open: controlledOpen,
    onOpenChange,
}: {
    repo: string | null;
    onChange: (repo: string | null) => void;
    /** * Further projects picked together with `repo` (read-only context for the AI). */
    extras: string[];
    onExtrasChange: (extras: string[]) => void;
    connected: boolean;
    disabled?: boolean;
    /** * Only a small + (to add projects next to the chips of the ones already picked). */
    compact?: boolean;
    /** * Name of the picked group; empty means the first repo's own name. */
    projectTitle?: string;
    onProjectTitleChange?: (title: string) => void;
    /** * Controlled mode: the dialog is opened from elsewhere (a menu item) and no button is drawn. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const [innerOpen, setInnerOpen] = useState(false);
    const controlled = controlledOpen !== undefined;
    const open = controlledOpen ?? innerOpen;
    const setOpen = onOpenChange ?? setInnerOpen;
    const [repos, setRepos] = useState<AiChatRepo[] | null>(null);
    // * Same cached request as the Code tab: labels only, never a server path.
    const { data: local, mutate } = useCachedRequest(
        'local.status',
        TTL_MS,
        () =>
            api
                .get<{
                    enabled: boolean;
                    can_read: boolean;
                    can_write: boolean;
                    roots: LocalRoot[];
                    projects: LocalProject[];
                }>('/ai-chat/local/status')
                .then(({ data }) => data),
        open,
    );

    useEffect(() => {
        if (!open || !connected) {
            return;
        }

        let cancelled = false;

        // * Shares the Code tab's cached request (5 minutes).
        cachedRequest('github.repos', TTL_MS, () =>
            api
                .get<{ repos: AiChatRepo[] }>(reposRoute.url())
                .then(({ data }) => data.repos),
        )
            .then((rows) => !cancelled && setRepos(rows))
            .catch(() => !cancelled && setRepos([]));

        return () => {
            cancelled = true;
        };
    }, [open, connected]);

    const selected = repo === null ? [] : [repo, ...extras];

    const changed = (change: LocalProjectsChange) => {
        invalidateAiChatCache('local.');

        if (local) {
            mutate({ ...local, ...change });
        }
    };

    return (
        <>
            {controlled ? null : compact && selected.length > 0 ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label="Thêm dự án"
                    title="Thêm dự án"
                    className="size-8 text-foreground/70 hover:text-foreground"
                    onClick={() => setOpen(true)}
                >
                    <Plus aria-hidden="true" />
                </Button>
            ) : (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    aria-label="Chọn dự án"
                    className="h-7 max-w-44 gap-1.5 border border-border/60 bg-muted/40 px-2 text-muted-foreground hover:bg-muted/70"
                    onClick={() => setOpen(true)}
                >
                    <SourceIcon local={repo?.startsWith('local:') === true} />
                    <span className="truncate">Dự án</span>
                </Button>
            )}
            <LocalProjectDialog
                open={open}
                onOpenChange={setOpen}
                projects={local?.projects ?? []}
                onChanged={changed}
                unavailable={localUnavailableReason(local)}
                githubRepos={connected ? repos : null}
                localRoots={local?.enabled && local.can_read ? local.roots : []}
                selected={selected}
                projectTitle={projectTitle}
                onPickRepos={(list, title) => {
                    onProjectTitleChange?.(title);
                    onChange(list[0] ?? null);
                    onExtrasChange(list.slice(1));
                }}
            />
        </>
    );
}
