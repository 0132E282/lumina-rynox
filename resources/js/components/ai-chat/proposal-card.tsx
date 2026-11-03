import {
    ExternalLink,
    Eye,
    GitPullRequest,
    HardDrive,
    Undo2,
} from 'lucide-react';
import { FileIcon } from '@/components/ai-chat/file-icon';
import { invalidateAiChatCache } from '@/lib/ai-chat-cache';
import { useState } from 'react';
import {
    applyProposals,
    rejectProposals,
} from '@/actions/App/Http/Controllers/AiChatController';
import { Button } from '@/components/ui/button';
import { aiErrorMessage } from '@/lib/ai-error';
import { planRunMessage } from '@/lib/project-plans';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AiChatProposal } from '@/types';

/** * The tasks of a proposed plan file, handed to the AI as one message. */
function planMessage(plan: AiChatProposal): string {
    let tasks: { id: string | null; title: string }[] = [];

    try {
        const rows: unknown[] = JSON.parse(plan.content)?.content?.tasks ?? [];

        tasks = rows.map((row) => {
            const task = (row ?? {}) as Record<string, unknown>;

            return {
                id: task.id === undefined ? null : String(task.id),
                title: String(task.title ?? ''),
            };
        });
    } catch {
        // * Not readable as a plan: the file path alone is sent.
    }

    return planRunMessage(plan.path, tasks);
}

const ACTION_LABELS = { create: 'Thêm mới', update: 'Sửa' } as const;

/** * The AI's proposed file edits for one answer: a row per file (a click opens the file's changed lines in the code viewer), then approve (opens a pull request) or dismiss. Nothing reaches GitHub before approval. */
export function ProposalCard({
    messageId,
    proposals,
    onChange,
    onOpenFile,
    onExecutePlan,
}: {
    messageId: number;
    proposals: AiChatProposal[];
    onChange: (proposals: AiChatProposal[]) => void;
    /** Opens the file in the code viewer (as a diff while the edit is pending). */
    onOpenFile?: (repo: string, path: string) => void;
    /** Sends a follow-up message: approving a plan file ("Duyệt và làm") then asks the AI to start working through its tasks. */
    onExecutePlan?: (message: string) => void;
}) {
    const [busy, setBusy] = useState<'apply' | 'reject' | 'revert' | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);
    const pending = proposals.some((proposal) => proposal.status === 'pending');
    // * Edits for a folder of this machine (`local:{id}`) are applied by writing the file, not by opening a pull request.
    const isLocal = proposals[0].repo.startsWith('local:');
    // * A plan the AI wrote into docs/plans (the index file alone is not a plan).
    const planFile = proposals.find(
        (proposal) =>
            /^docs\/plans\/(?!index\.json$)[\w.-]+\.json$/.test(
                proposal.path,
            ) && proposal.status === 'pending',
    );
    const pullUrl = proposals.find((proposal) => proposal.pull_url)?.pull_url;
    // * The first file whose change is still shown in the viewer (a dismissed edit is not).
    const reviewable = proposals.find(
        (proposal) =>
            proposal.status !== 'rejected' && proposal.status !== 'reverted',
    );
    // * Local edits are written as soon as the AI answers; an applied one can still be undone.
    const revertible =
        isLocal && proposals.some((proposal) => proposal.status === 'applied');

    // * "Duyệt và làm" on a GitHub project: no pull request and no write to the repo. The agent starts from the plan itself (its task list goes into the message, since the repo does not have the file yet).
    const [started, setStarted] = useState(false);
    const startPlan = () => {
        if (planFile && onExecutePlan) {
            setStarted(true);
            onExecutePlan(planMessage(planFile));
        }
    };

    const run = async (kind: 'apply' | 'reject' | 'revert') => {
        setBusy(kind);
        setError(null);

        try {
            const route = kind === 'apply' ? applyProposals : rejectProposals;
            const { data } = await api.post<{ proposals: AiChatProposal[] }>(
                kind === 'revert'
                    ? `/ai-chat/messages/${messageId}/proposals/revert-local`
                    : kind === 'apply' && isLocal
                      ? `/ai-chat/messages/${messageId}/proposals/apply-local`
                      : route.url(messageId),
            );

            // * Applied edits change the files: cached trees and file texts of this repo are stale.
            invalidateAiChatCache(`tree.${proposals[0].repo}`);
            invalidateAiChatCache(`file.${proposals[0].repo}.`);
            onChange(data.proposals);

            // * A plan written into a folder of this machine: the AI goes on with its tasks.
            if (kind === 'apply' && isLocal && planFile && onExecutePlan) {
                onExecutePlan(planMessage(planFile));
            }
        } catch (caught) {
            setError(aiErrorMessage(caught));

            // * A conflict or partial write still returns the current proposal states.
            const states = (
                caught as {
                    response?: { data?: { proposals?: AiChatProposal[] } };
                }
            ).response?.data?.proposals;

            if (states) {
                onChange(states);
            }
        } finally {
            setBusy(null);
        }
    };

    return (
        <section
            aria-label="Đề xuất sửa file"
            className="flex w-full flex-col gap-3 rounded-xl border bg-card p-3"
        >
            <h3 className="flex items-center gap-2 text-sm font-medium">
                {isLocal ? (
                    <HardDrive aria-hidden="true" className="size-4" />
                ) : (
                    <GitPullRequest aria-hidden="true" className="size-4" />
                )}
                {isLocal
                    ? `Đã sửa ${proposals.length} file trên máy local (${proposals[0].repo.slice(6)})`
                    : `Đề xuất sửa ${proposals.length} file trong ${proposals[0].repo}`}
            </h3>
            <ul className="flex flex-col gap-2">
                {proposals.map((proposal) => {
                    const label = (
                        <>
                            <FileIcon
                                name={
                                    proposal.path.split('/').pop() ??
                                    proposal.path
                                }
                            />
                            <span className="truncate font-mono text-xs">
                                {proposal.path}
                            </span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                {/* * A plan not yet approved is still being drawn up. */}
                                {planFile &&
                                proposal.status === 'pending' &&
                                proposal.path.startsWith('docs/plans/')
                                    ? 'Đang lập'
                                    : ACTION_LABELS[proposal.action]}
                                {proposal.status !== 'pending' &&
                                    ` · ${proposal.status === 'applied' ? (isLocal ? 'đã áp dụng' : 'đã tạo PR') : proposal.status === 'reverted' ? 'đã hoàn tác' : 'đã bỏ qua'}`}
                            </span>
                        </>
                    );
                    const row =
                        'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm';

                    return (
                        <li key={proposal.id}>
                            {onOpenFile ? (
                                // * The changed lines open in the code viewer, on the file itself.
                                <button
                                    type="button"
                                    title="Mở file và xem các dòng đã đổi"
                                    onClick={() =>
                                        onOpenFile(proposal.repo, proposal.path)
                                    }
                                    className={cn(
                                        row,
                                        'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                    )}
                                >
                                    {label}
                                </button>
                            ) : (
                                <div className={row}>{label}</div>
                            )}
                        </li>
                    );
                })}
            </ul>
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            {pending ? (
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        size="sm"
                        disabled={busy !== null || started}
                        onClick={() =>
                            planFile && onExecutePlan && !isLocal
                                ? startPlan()
                                : void run('apply')
                        }
                    >
                        {busy === 'apply'
                            ? isLocal
                                ? 'Đang ghi tệp...'
                                : 'Đang tạo Pull Request...'
                            : planFile && onExecutePlan
                              ? started
                                  ? 'Đã giao agent làm'
                                  : 'Duyệt và làm'
                              : isLocal
                                ? 'Áp dụng'
                                : 'Duyệt và tạo Pull Request'}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => void run('reject')}
                    >
                        Bỏ qua
                    </Button>
                    <span className="basis-full text-xs text-muted-foreground">
                        {isLocal
                            ? 'Chỉ ghi vào máy khi bạn bấm Áp dụng; tệp đã đổi kể từ lúc đề xuất sẽ bị từ chối.'
                            : planFile && onExecutePlan
                              ? 'Giao agent làm ngay, không ghi vào repo và không tạo Pull Request.'
                              : 'Tạo nhánh mới và Pull Request, không ghi thẳng vào nhánh chính.'}
                    </span>
                </div>
            ) : (
                (reviewable || revertible || pullUrl) && (
                    <div className="flex flex-wrap items-center gap-3">
                        {reviewable && onOpenFile && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                    onOpenFile(reviewable.repo, reviewable.path)
                                }
                            >
                                <Eye aria-hidden="true" />
                                Xem lại thay đổi
                            </Button>
                        )}
                        {revertible && (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={busy !== null}
                                onClick={() => void run('revert')}
                            >
                                <Undo2 aria-hidden="true" />
                                {busy === 'revert'
                                    ? 'Đang hoàn tác...'
                                    : 'Hoàn tác'}
                            </Button>
                        )}
                        {pullUrl && (
                            <a
                                href={pullUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="flex w-fit items-center gap-1.5 text-sm underline underline-offset-2"
                            >
                                Mở Pull Request trên GitHub
                                <ExternalLink
                                    aria-hidden="true"
                                    className="size-3.5"
                                />
                            </a>
                        )}
                    </div>
                )
            )}
        </section>
    );
}
