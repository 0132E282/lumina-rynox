import { useEffect, useMemo, useState } from 'react';
import { loadPlanIndex, loadPlanTasks } from '@/lib/project-plans';
import type { PlanDrafts, PlanEntry, PlanTask } from '@/lib/project-plans';
import type { AiChatProposal } from '@/types';

/** * The plans of the picked project (`docs/plans/index.json`) and the tasks of the chosen one. Loads only while `enabled` (the panel is open). */
export function useProjectPlans(
    repo: string | null,
    enabled: boolean,
    proposals: AiChatProposal[],
) {
    // * Plan files the AI proposed in this chat (not rejected or reverted): read from the proposal, since the project may not have them yet.
    const draftKey = JSON.stringify(
        proposals
            .filter(
                (proposal) =>
                    proposal.repo === repo &&
                    /^docs\/plans\/[\w.-]+\.json$/.test(proposal.path) &&
                    (proposal.status === 'pending' ||
                        proposal.status === 'applied'),
            )
            .map((proposal) => [proposal.path, proposal.content]),
    );
    const drafts: PlanDrafts = useMemo(
        () => new Map(JSON.parse(draftKey) as [string, string][]),
        [draftKey],
    );

    const [plans, setPlans] = useState<PlanEntry[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [tasks, setTasks] = useState<PlanTask[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (repo === null) {
            setPlans([]);
            setSelected(null);

            return;
        }

        if (!enabled) {
            return;
        }

        let cancelled = false;

        loadPlanIndex(repo, drafts).then((entries) => {
            if (cancelled) {
                return;
            }

            setPlans(entries);
            // * Keeps the pick while it still exists; otherwise the first (newest) plan.
            setSelected((current) =>
                entries.some((entry) => entry.path === current)
                    ? current
                    : (entries[0]?.path ?? null),
            );
        });

        return () => {
            cancelled = true;
        };
    }, [repo, enabled, drafts]);

    useEffect(() => {
        if (repo === null || selected === null) {
            setTasks([]);
            setError(null);

            return;
        }

        let cancelled = false;

        loadPlanTasks(repo, selected, drafts)
            .then((rows) => {
                if (!cancelled) {
                    setTasks(rows);
                    setError(null);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setTasks([]);
                    setError('Không đọc được plan này.');
                }
            });

        return () => {
            cancelled = true;
        };
    }, [repo, selected, drafts]);

    return { plans, selected, setSelected, tasks, error };
}
