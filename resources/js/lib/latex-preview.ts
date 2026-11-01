/**
 * A small, approximate reader of the LaTeX the CV uses (sections, lists, bold/italic, links, escapes). It builds plain data (never HTML),
 * so nothing typed in the box can inject markup. It is a preview of the content and its structure, not a typeset PDF.
 */
export type Inline = { text: string; bold?: boolean; italic?: boolean };

export type Block =
    | { type: 'title'; text: Inline[] }
    | { type: 'section'; level: 1 | 2; text: Inline[] }
    | { type: 'paragraph'; text: Inline[] }
    | { type: 'list'; items: Inline[][] };

const ESCAPES: Record<string, string> = {
    '&': '&',
    '%': '%',
    $: '$',
    '#': '#',
    _: '_',
    '{': '{',
    '}': '}',
    '~': '~',
    '\\': '\n',
};

/** Reads `{...}` starting at `start` (which must be the opening brace); returns the inside and the index after the closing brace. */
function group(source: string, start: number): [string, number] {
    let depth = 0;

    for (let index = start; index < source.length; index += 1) {
        const char = source[index];

        if (char === '\\') {
            index += 1;
        } else if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;

            if (depth === 0) {
                return [source.slice(start + 1, index), index + 1];
            }
        }
    }

    return [source.slice(start + 1), source.length];
}

export function inline(source: string, bold = false, italic = false): Inline[] {
    const parts: Inline[] = [];
    let buffer = '';

    const flush = () => {
        if (buffer !== '') {
            parts.push({ text: buffer, bold, italic });
            buffer = '';
        }
    };

    for (let index = 0; index < source.length;) {
        const char = source[index];

        if (char === '%') {
            // * A comment runs to the end of the line.
            const end = source.indexOf('\n', index);
            index = end === -1 ? source.length : end;
            continue;
        }

        if (char !== '\\') {
            buffer += char === '{' || char === '}' ? '' : char;
            index += 1;
            continue;
        }

        const next = source[index + 1] ?? '';

        if (next in ESCAPES) {
            buffer += ESCAPES[next];
            index += 2;
            continue;
        }

        const name = /^[a-zA-Z]+/.exec(source.slice(index + 1))?.[0] ?? '';
        index += 1 + name.length;
        let argument = '';

        while (source[index] === ' ' && name !== '') {
            index += 1;
        }

        if (source[index] === '[') {
            index = source.indexOf(']', index) + 1 || source.length;
        }

        if (source[index] === '{') {
            [argument, index] = group(source, index);
        }

        if (name === 'textbf' || name === 'bfseries') {
            flush();
            parts.push(...inline(argument, true, italic));
        } else if (name === 'textit' || name === 'emph' || name === 'itshape') {
            flush();
            parts.push(...inline(argument, bold, true));
        } else if (name === 'href') {
            let label = '';

            if (source[index] === '{') {
                [label, index] = group(source, index);
            }

            flush();
            parts.push(...inline(label || argument, bold, italic));
        } else if (
            name === 'url' ||
            name === 'underline' ||
            name === 'textsc'
        ) {
            flush();
            parts.push(...inline(argument, bold, italic));
        }
        // * Every other command (spacing, fonts, `\hfill`...) is dropped; its braced argument is dropped too.
    }

    flush();

    return parts;
}

function paragraphs(text: string): Block[] {
    return text
        .split(/\n\s*\n/)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk): Block => ({ type: 'paragraph', text: inline(chunk) }));
}

export function parseLatex(source: string): Block[] {
    const body = /\\begin\{document\}([\s\S]*?)(\\end\{document\}|$)/.exec(
        source,
    );
    const preamble = body ? source.slice(0, body.index) : '';
    let rest = (body ? body[1] : source).replace(/\\maketitle/g, '');
    const blocks: Block[] = [];

    const title = /\\title\{/.exec(preamble);

    if (title) {
        blocks.push({
            type: 'title',
            text: inline(group(preamble, title.index + title[0].length - 1)[0]),
        });
    }

    const pattern =
        /\\(sub)?section\*?\{|\\begin\{(?:itemize|enumerate)\}([\s\S]*?)\\end\{(?:itemize|enumerate)\}/g;
    let last = 0;
    let found: RegExpExecArray | null;

    rest = rest.replace(/\\begin\{center\}|\\end\{center\}/g, '');

    while ((found = pattern.exec(rest)) !== null) {
        blocks.push(...paragraphs(rest.slice(last, found.index)));

        if (found[0].startsWith('\\begin')) {
            blocks.push({
                type: 'list',
                items: (found[2] ?? '')
                    .split(/\\item\b/)
                    .slice(1)
                    .map((item) => inline(item.trim()))
                    .filter((item) => item.length > 0),
            });
            last = pattern.lastIndex;
        } else {
            const [heading, end] = group(rest, pattern.lastIndex - 1);
            blocks.push({
                type: 'section',
                level: found[1] ? 2 : 1,
                text: inline(heading),
            });
            last = end;
            pattern.lastIndex = end;
        }
    }

    blocks.push(...paragraphs(rest.slice(last)));

    return blocks;
}
