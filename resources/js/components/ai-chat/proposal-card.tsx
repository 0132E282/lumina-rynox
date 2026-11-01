import { ExternalLink, GitPullRequest, HardDrive } from 'lucide-react';
import { useState } from 'react';
import {
    applyProposals,
    rejectProposals,
} from '@/actions/App/Http/Controllers/AiChatController';
import { Button } from '@/components/ui/button';
import { aiErrorMessage } from '@/lib/ai-error';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AiChatProposal } from '@/types';

const ACTION_LABELS = { create: 'Thêm mới', update: 'Sửa' } as const;

function lineClass(line: string): string {
    if (line.startsWith('+ ')) {
        return 'bg-green-500/15 text-green-800 dark:text-green-300';
    }

    if (line.startsWith('- ')) {
        return 'bg-red-500/15 text-red-800 dark:text-red-300';
    }

    return 'text-muted-foreground';
}

/** * The AI's proposed file edits for one answer: diff per file, then approve (opens a pull request) or dismiss. Nothing reaches GitHub before approval. */
export function ProposalCard({
    messageId,
    proposals,
    onChange,
}: {
    messageId: number;
    proposals: AiChatProposal[];
    onChange: (proposals: AiChatProposal[]) => void;
}) {
    const [busy, setBusy] = useState<'apply' | 'reject' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pending = proposals.some((proposal) => proposal.status === 'pending');
    // * Edits for a folder of this machine (`local:{id}`) are applied by writing the file, not by opening a pull request.
    const isLocal = proposals[0].repo.startsWith('local:');
    const pullUrl = proposals.find((proposal) => proposal.pull_url)?.pull_url;

    const run = async (kind: 'apply' | 'reject') => {
        setBusy(kind);
        setError(null);

        try {
            const route = kind === 'apply' ? applyProposals : rejectProposals;
            const { data } = await api.post<{ proposals: AiChatProposal[] }>(
                kind === 'apply' && isLocal
                    ? `/ai-chat/messages/${messageId}/proposals/apply-local`
                    : route.url(messageId),
            );

            onChange(data.proposals);
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
                    ? `Đề xuất sửa ${proposals.length} file trên máy local (${proposals[0].repo.slice(6)})`
                    : `Đề xuất sửa ${proposals.length} file trong ${proposals[0].repo}`}
            </h3>
            <ul className="flex flex-col gap-2">
                {proposals.map((proposal) => (
                    <li key={proposal.id}>
                        <details className="rounded-md border">
                            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                                <span className="truncate font-mono text-xs">
                                    {proposal.path}
                                </span>
                                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                    {ACTION_LABELS[proposal.action]}
                                    {proposal.status !== 'pending' &&
                                        ` · ${proposal.status === 'applied' ? (isLocal ? 'đã áp dụng' : 'đã tạo PR') : 'đã bỏ qua'}`}
                                </span>
                            </summary>
                            <pre className="max-h-80 overflow-auto border-t py-1 font-mono text-xs leading-5">
                                {(proposal.diff ?? '')
                                    .split('\n')
                                    .map((line, index) => (
                                        <div
                                            key={index}
                                            className={cn(
                                                'px-3 whitespace-pre',
                                                lineClass(line),
                                            )}
                                        >
                                            {line || ' '}
                                        </div>
                                    ))}
                            </pre>
                        </details>
                    </li>
                ))}
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
                        disabled={busy !== null}
                        onClick={() => void run('apply')}
                    >
                        {busy === 'apply'
                            ? isLocal
                                ? 'Đang ghi tệp...'
                                : 'Đang tạo Pull Request...'
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
                    <span className="text-xs text-muted-foreground">
                        {isLocal
                            ? 'Chỉ ghi vào máy khi bạn bấm Áp dụng; tệp đã đổi kể từ lúc đề xuất sẽ bị từ chối.'
                            : 'Tạo nhánh mới và Pull Request, không ghi thẳng vào nhánh chính.'}
                    </span>
                </div>
            ) : (
                pullUrl && (
                    <a
                        href={pullUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex w-fit items-center gap-1.5 text-sm underline underline-offset-2"
                    >
                        Mở Pull Request trên GitHub
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                )
            )}
        </section>
    );
}
