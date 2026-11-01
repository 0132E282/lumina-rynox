import { FileIcon } from '@/components/ai-chat/file-icon';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import type { ChoiceHandlers } from '@/components/ai-chat/choice-card';

// * The line the server leaves in the answer where the AI proposed a file edit (EditProposalExtractor).
const PROPOSAL_LINE = /^📝 Đề xuất sửa: (.+)$/;
const FENCE = /^\s*(```|~~~)/;

type Part = { kind: 'text'; text: string } | { kind: 'file'; path: string };

/** * Splits an answer into markdown text and the proposal lines (a line inside a code fence stays text). */
function splitProposalLines(content: string): Part[] {
    const parts: Part[] = [];
    let buffer: string[] = [];
    let fenced = false;

    const flush = () => {
        if (buffer.length > 0) {
            parts.push({ kind: 'text', text: buffer.join('\n') });
            buffer = [];
        }
    };

    for (const line of content.split('\n')) {
        if (FENCE.test(line)) {
            fenced = !fenced;
        }

        const match = fenced ? null : PROPOSAL_LINE.exec(line.trim());

        if (match === null) {
            buffer.push(line);

            continue;
        }

        flush();
        parts.push({ kind: 'file', path: match[1].trim() });
    }

    flush();

    return parts;
}

/** * An assistant answer: markdown. The "📝 Đề xuất sửa: path" lines are left out when the answer has an edit card (the card lists those files); without a card each shows as a file chip with the file's icon. */
export function ProposalText({
    content,
    hasCard = false,
    choices,
}: {
    content: string;
    /** The answer is followed by its edit card, which already lists the files. */
    hasCard?: boolean;
    choices?: ChoiceHandlers;
}) {
    if (!content.includes('📝 Đề xuất sửa: ')) {
        return <MarkdownContent content={content} choices={choices} />;
    }

    return (
        <>
            {splitProposalLines(content).map((part, index) => {
                if (part.kind === 'text') {
                    return (
                        <MarkdownContent
                            key={index}
                            content={part.text}
                            choices={choices}
                        />
                    );
                }

                if (hasCard) {
                    return null;
                }

                return (
                    <div
                        key={index}
                        className="my-1 flex max-w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs"
                    >
                        <FileIcon
                            name={part.path.split('/').pop() ?? part.path}
                        />
                        <span className="truncate">{part.path}</span>
                    </div>
                );
            })}
        </>
    );
}
