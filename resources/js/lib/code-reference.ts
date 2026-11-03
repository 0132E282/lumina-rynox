/** * A piece of code picked in the code viewer: the chat shows it as a small tag (file and lines) and sends the code with the message. A copied file path is the same thing with no lines (`startLine` 0, `text` = the path): a tag with the file name only. */
export type CodeReference = {
    path: string;
    startLine: number;
    endLine: number;
    text: string;
    /** * Added by itself for the file open in the viewer (replaced when another file opens), not picked by the person. */
    auto?: boolean;
    /** * The mark shown inside the typed text where the person pasted it (`[file.ts:12-20]`); on send the mark is replaced by the reference in place. */
    token?: string;
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

const isWholeFile = (reference: CodeReference) => reference.startLine === 0;

export function referenceLines(reference: CodeReference): string {
    return reference.startLine === reference.endLine
        ? `${reference.startLine}`
        : `${reference.startLine}-${reference.endLine}`;
}

/** * `file.ts:12-20`: what the tag shows. */
export function referenceLabel(reference: CodeReference): string {
    const name = reference.path.split('/').pop() ?? reference.path;

    return isWholeFile(reference)
        ? name
        : `${name}:${referenceLines(reference)}`;
}

/** * `path/to/file.ts:12-20` (just the path for a whole file): the tag's tooltip. */
export function referenceTitle(reference: CodeReference): string {
    return isWholeFile(reference)
        ? reference.path
        : `${reference.path}:${referenceLines(reference)}`;
}

/** * The message text of a reference: the full path with the lines, then the code. */
export function referenceBlock(reference: CodeReference): string {
    if (isWholeFile(reference)) {
        return `\`${reference.path}\``;
    }

    const code =
        reference.text.length > SNIPPET_LIMIT
            ? `${reference.text.slice(0, SNIPPET_LIMIT)}\n...`
            : reference.text;

    return `\`${reference.path}:${referenceLines(reference)}\`\n\`\`\`\n${code}\n\`\`\``;
}

const FILE_TAG = /^`([^`\s]+)`$/;
const PATH_LIKE = /\/|\.[A-Za-z0-9]{1,8}$/;

/**
 * Splits a sent message into the file tags it carries (a whole-file reference is a paragraph of just `` `path` ``) and the rest of the text, so the thread can show the tags as chips before the text.
 * Paragraphs inside a code block are never taken as tags.
 */
export function splitFileTags(content: string): {
    files: string[];
    text: string;
} {
    const files: string[] = [];
    const kept: string[] = [];
    let inFence = false;

    for (const paragraph of content.split('\n\n')) {
        const tag = inFence ? null : FILE_TAG.exec(paragraph.trim());

        if (tag !== null && PATH_LIKE.test(tag[1])) {
            files.push(tag[1]);
        } else {
            kept.push(paragraph);
        }

        if ((paragraph.match(/```/g) ?? []).length % 2 === 1) {
            inFence = !inFence;
        }
    }

    return { files, text: kept.join('\n\n').trim() };
}

/** * `[file.ts:12-20]` (numbered `#2`... when the same label is already in the text): the mark a pasted reference leaves at the cursor. */
export function referenceToken(
    reference: CodeReference,
    taken: Array<string | undefined>,
): string {
    const label = referenceLabel(reference);
    let token = `[${label}]`;

    for (let n = 2; taken.includes(token); n++) {
        token = `[${label} #${n}]`;
    }

    return token;
}

/**
 * The message text of a draft: every reference's mark is replaced, where it stands, by the reference itself (the file path, or the path with the picked code).
 * References without a mark (the open file, picked with "Chat với AI") are appended after the text; a mark the person deleted from the text drops its reference.
 */
export function expandReferences(
    draft: string,
    references: CodeReference[],
): string {
    let body = draft.trim();

    for (const reference of references) {
        if (reference.token === undefined || !body.includes(reference.token)) {
            continue;
        }

        body = body.replace(reference.token, () =>
            isWholeFile(reference)
                ? `\`${reference.path}\``
                : `\n${referenceBlock(reference)}\n`,
        );
    }

    return [
        body.trim(),
        ...references
            .filter((reference) => reference.token === undefined)
            .map(referenceBlock),
    ]
        .filter((part) => part !== '')
        .join('\n\n')
        .trim();
}
