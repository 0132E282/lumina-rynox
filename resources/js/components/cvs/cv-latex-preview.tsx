import { useMemo } from 'react';
import { useWatch } from 'react-hook-form';
import type { Inline } from '@/lib/latex-preview';
import { parseLatex } from '@/lib/latex-preview';

function Text({ parts }: { parts: Inline[] }) {
    return (
        <>
            {parts.map((part, index) => (
                <span
                    key={index}
                    className={[
                        part.bold && 'font-semibold',
                        part.italic && 'italic',
                        'whitespace-pre-line',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                >
                    {part.text}
                </span>
            ))}
        </>
    );
}

/**
 * "Xem trước" of the LaTeX box: an approximate, read-only rendering of its content and structure (see `lib/latex-preview`).
 * It is not the typeset PDF: compile with pdflatex or Overleaf for that.
 */
export function CvLatexPreview() {
    const source = String(useWatch({ name: 'latex' }) ?? '');
    const blocks = useMemo(
        () => (source.trim() !== '' ? parseLatex(source) : []),
        [source],
    );

    return (
        <div className="flex w-full flex-col gap-2">
            {blocks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    Ô CV dạng LaTeX đang trống.
                </p>
            ) : (
                <div className="mx-auto w-full max-w-[210mm] rounded-sm border bg-white p-8 text-sm leading-relaxed text-black shadow-sm">
                    {blocks.map((block, index) => {
                        if (block.type === 'title') {
                            return (
                                <h1
                                    key={index}
                                    className="mb-3 text-center text-2xl font-semibold"
                                >
                                    <Text parts={block.text} />
                                </h1>
                            );
                        }

                        if (block.type === 'section') {
                            return (
                                <h2
                                    key={index}
                                    className={
                                        block.level === 1
                                            ? 'mt-4 mb-1 border-b border-black/30 text-base font-semibold uppercase'
                                            : 'mt-2 font-semibold'
                                    }
                                >
                                    <Text parts={block.text} />
                                </h2>
                            );
                        }

                        if (block.type === 'list') {
                            return (
                                <ul key={index} className="my-1 list-disc pl-6">
                                    {block.items.map((item, itemIndex) => (
                                        <li key={itemIndex}>
                                            <Text parts={item} />
                                        </li>
                                    ))}
                                </ul>
                            );
                        }

                        return (
                            <p key={index} className="my-1">
                                <Text parts={block.text} />
                            </p>
                        );
                    })}
                    <p className="mt-6 border-t pt-2 text-xs text-black/50">
                        Xem trước gần đúng về nội dung và cấu trúc, không phải
                        bản dàn trang PDF.
                    </p>
                </div>
            )}
        </div>
    );
}
