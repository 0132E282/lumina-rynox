import { Editor } from '@monaco-editor/react';
import {
    READ_ONLY_OPTIONS,
    languageOf,
    monacoTheme,
} from '@/components/ai-chat/monaco-setup';

/** * Read-only Monaco editor for one file (loaded lazily by the code viewer). */
export default function MonacoCode({
    path,
    value,
}: {
    path: string;
    value: string;
}) {
    return (
        <Editor
            path={path}
            value={value}
            language={languageOf(path)}
            theme={monacoTheme()}
            loading={
                <p className="m-4 text-sm text-muted-foreground">Đang tải...</p>
            }
            options={{ ...READ_ONLY_OPTIONS }}
        />
    );
}
