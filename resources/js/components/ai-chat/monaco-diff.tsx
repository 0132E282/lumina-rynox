import { DiffEditor } from '@monaco-editor/react';
import {
    READ_ONLY_OPTIONS,
    languageOf,
    monacoTheme,
} from '@/components/ai-chat/monaco-setup';

/** * Read-only side-by-side diff (red = removed, green = added) of a file and the AI's proposed version. */
export default function MonacoDiff({
    path,
    original,
    modified,
}: {
    path: string;
    original: string;
    modified: string;
}) {
    return (
        <DiffEditor
            original={original}
            modified={modified}
            originalModelPath={`original/${path}`}
            modifiedModelPath={`modified/${path}`}
            language={languageOf(path)}
            theme={monacoTheme()}
            loading={
                <p className="m-4 text-sm text-muted-foreground">Đang tải...</p>
            }
            options={{
                ...READ_ONLY_OPTIONS,
                renderSideBySide: false,
                // * Removed lines are drawn inside the one editor (not in a separate box), so selecting text shows the highlight on them too.
                experimental: { useTrueInlineView: true },
                // * Only the changed lines and 3 around them, with line numbers, like a pull request.
                hideUnchangedRegions: {
                    enabled: true,
                    contextLineCount: 3,
                    minimumLineCount: 3,
                },
                enableSplitViewResizing: false,
                renderOverviewRuler: false,
                originalEditable: false,
            }}
        />
    );
}
