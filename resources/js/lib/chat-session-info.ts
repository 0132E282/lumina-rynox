import { parseDiff } from '@/lib/diff-parser';

/** Rough token count: about 4 characters per token. The provider's real usage is not stored. */
export const CHARS_PER_TOKEN = 4;

export const estimateTokens = (chars: number): number =>
    Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);

export type ContextUsage = {
    windowTokens: number;
    usedTokens: number;
    freeTokens: number;
    /** Share of the window per part, 0 to 100 (they sum to at most 100). */
    parts: {
        key: 'user' | 'assistant' | 'system' | 'free';
        tokens: number;
        percent: number;
    }[];
};

/** * Estimated context usage of one conversation from character counts (pure; estimate only). */
export function computeContextUsage(input: {
    userChars: number;
    assistantChars: number;
    systemChars: number;
    windowTokens: number;
}): ContextUsage {
    const windowTokens = Math.max(1, input.windowTokens);
    const user = estimateTokens(input.userChars);
    const assistant = estimateTokens(input.assistantChars);
    const system = estimateTokens(input.systemChars);
    const usedTokens = Math.min(windowTokens, user + assistant + system);
    const freeTokens = windowTokens - usedTokens;
    const percent = (tokens: number) =>
        Math.min(100, (tokens / windowTokens) * 100);

    return {
        windowTokens,
        usedTokens,
        freeTokens,
        parts: [
            { key: 'user', tokens: user, percent: percent(user) },
            {
                key: 'assistant',
                tokens: assistant,
                percent: percent(assistant),
            },
            { key: 'system', tokens: system, percent: percent(system) },
            { key: 'free', tokens: freeTokens, percent: percent(freeTokens) },
        ],
    };
}

const DIFF_FENCE = /```(?:diff|patch)[^\n]*\n([\s\S]*?)```/g;

/** * Lines added and removed across the ```diff / ```patch blocks of the given assistant answers (pure). */
export function sumDiffChanges(answers: string[]): {
    added: number;
    removed: number;
} {
    let added = 0;
    let removed = 0;

    for (const answer of answers) {
        for (const match of answer.matchAll(DIFF_FENCE)) {
            for (const row of parseDiff(match[1]) ?? []) {
                if (row.kind === 'add') {
                    added++;
                } else if (row.kind === 'del') {
                    removed++;
                }
            }
        }
    }

    return { added, removed };
}
