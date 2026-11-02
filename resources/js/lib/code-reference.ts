/** * A piece of code picked in the code viewer: the chat shows it as a small tag (file and lines) and sends the code with the message. */
export type CodeReference = {
    path: string;
    startLine: number;
    endLine: number;
    text: string;
};

// * Most characters of one picked snippet that go into a message (the server accepts 2000 characters per message).
const SNIPPET_LIMIT = 1200;

let lastCopied: CodeReference | null = null;

/** * The viewer calls this when the person copies lines, so pasting them into the chat can become a tag instead of the raw code. */
export function rememberCopied(reference: CodeReference): void {
    lastCopied = reference;
}

/** * The reference the pasted text came from, or null when it is just text from somewhere else. */
export function takeCopied(pasted: string): CodeReference | null {
    return lastCopied !== null && lastCopied.text.trim() === pasted.trim()
        ? lastCopied
        : null;
}

export function referenceLines(reference: CodeReference): string {
    return reference.startLine === reference.endLine
        ? `${reference.startLine}`
        : `${reference.startLine}-${reference.endLine}`;
}

/** * `file.ts:12-20`: what the tag shows. */
export function referenceLabel(reference: CodeReference): string {
    return `${reference.path.split('/').pop() ?? reference.path}:${referenceLines(reference)}`;
}

/** * The message text of a reference: the full path with the lines, then the code. */
export function referenceBlock(reference: CodeReference): string {
    const code =
        reference.text.length > SNIPPET_LIMIT
            ? `${reference.text.slice(0, SNIPPET_LIMIT)}\n...`
            : reference.text;

    return `\`${reference.path}:${referenceLines(reference)}\`\n\`\`\`\n${code}\n\`\`\``;
}
