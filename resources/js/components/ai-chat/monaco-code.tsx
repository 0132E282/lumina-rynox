import { rememberCopied } from '@/lib/code-reference';
import { Editor } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import { lineChanges } from '@/lib/line-changes';
import type { Hunk } from '@/lib/line-changes';
import {
    READ_ONLY_OPTIONS,
    languageOf,
    monacoTheme,
} from '@/components/ai-chat/monaco-setup';

/** * Monaco editor for one file (loaded lazily by the code viewer): read-only unless `onChange` is given, then Cmd/Ctrl+S calls `onSave`. */
export default function MonacoCode({
    path,
    value,
    onChange,
    onSave,
    onAsk,
    baseline,
}: {
    path: string;
    value: string;
    onChange?: (value: string) => void;
    onSave?: () => void;
    /** * Adds "Chat với AI" to the right-click menu: called with the selected lines. */
    /** * The file as it is in git HEAD: lines that differ get a mark in the margin. */
    baseline?: string | null;
    onAsk?: (selection: {
        startLine: number;
        endLine: number;
        text: string;
    }) => void;
}) {
    const editable = onChange !== undefined;
    // * The editor outlives renders: its save command always calls the newest handler.
    const saveRef = useRef(onSave);

    saveRef.current = onSave;
    const pathRef = useRef(path);

    pathRef.current = path;
    const askRef = useRef(onAsk);

    askRef.current = onAsk;
    const monacoRef = useRef<Monaco | null>(null);
    const [instance, setInstance] =
        useState<editor.IStandaloneCodeEditor | null>(null);

    useEffect(() => {
        if (instance === null || baseline === undefined || baseline === null) {
            return;
        }

        const collection = instance.createDecorationsCollection();
        let timer: number | undefined;
        let hunks: Hunk[] = [];
        let popup: editor.IContentWidget | null = null;

        const closePopup = () => {
            if (popup !== null) {
                instance.removeContentWidget(popup);
                popup = null;
            }
        };

        // * Puts one block back as it is in git HEAD, as an ordinary edit (undo brings it back; the file is saved when the person saves).
        const revert = (hunk: Hunk) => {
            const model = instance.getModel();

            if (model === null) {
                return;
            }

            const total = model.getLineCount();
            const end = (line: number) => model.getLineMaxColumn(line);
            const last = hunk.start + hunk.count;
            const oldText = hunk.old.join('\n');
            let range = {
                startLineNumber: hunk.start + 1,
                startColumn: 1,
                endLineNumber: last,
                endColumn: last >= 1 ? end(Math.min(last, total)) : 1,
            };
            let text = oldText;

            if (hunk.count === 0) {
                // * Only lines were removed: put them back where they were.
                if (hunk.start < total) {
                    range = {
                        startLineNumber: hunk.start + 1,
                        startColumn: 1,
                        endLineNumber: hunk.start + 1,
                        endColumn: 1,
                    };
                    text = `${oldText}\n`;
                } else {
                    range = {
                        startLineNumber: total,
                        startColumn: end(total),
                        endLineNumber: total,
                        endColumn: end(total),
                    };
                    text = `\n${oldText}`;
                }
            } else if (hunk.old.length === 0) {
                // * Only lines were added: take them out with their line break.
                if (last < total) {
                    range.endLineNumber = last + 1;
                    range.endColumn = 1;
                } else if (hunk.start > 0) {
                    range.startLineNumber = hunk.start;
                    range.startColumn = end(hunk.start);
                }

                text = '';
            }

            instance.executeEdits('pm-revert', [{ range, text }]);
            instance.pushUndoStop();
        };

        // * A click on a change mark in the margin offers to revert that block (like the git margin of an editor).
        const click = instance.onMouseDown((event) => {
            const monaco = monacoRef.current;

            closePopup();

            if (
                monaco === null ||
                event.target.type !==
                    monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS ||
                event.target.position === null
            ) {
                return;
            }

            const line = event.target.position.lineNumber;
            const total = instance.getModel()?.getLineCount() ?? 0;
            const hunk = hunks.find((item) =>
                item.count === 0
                    ? Math.min(item.start + 1, total) === line
                    : line > item.start && line <= item.start + item.count,
            );

            if (hunk === undefined) {
                return;
            }

            const node = document.createElement('button');

            node.type = 'button';
            node.className = 'pm-revert-pop';
            node.textContent = '\u21B6 Hoàn tác đoạn này';
            node.onclick = () => {
                closePopup();
                revert(hunk);
            };
            popup = {
                getId: () => 'pm.revert-hunk',
                getDomNode: () => node,
                getPosition: () => ({
                    position: { lineNumber: line, column: 1 },
                    preference: [
                        monaco.editor.ContentWidgetPositionPreference.BELOW,
                    ],
                }),
            };
            instance.addContentWidget(popup);
        });

        const paint = () => {
            const changes = lineChanges(baseline, instance.getValue());

            hunks = changes.hunks;
            const rows = (
                lines: number[],
                className: string,
            ): editor.IModelDeltaDecoration[] =>
                lines.map((line) => ({
                    range: {
                        startLineNumber: line,
                        startColumn: 1,
                        endLineNumber: line,
                        endColumn: 1,
                    },
                    options: {
                        isWholeLine: true,
                        linesDecorationsClassName: className,
                    },
                }));

            collection.set([
                ...rows(changes.added, 'pm-gutter-added'),
                ...rows(changes.modified, 'pm-gutter-modified'),
                ...rows(changes.deleted, 'pm-gutter-deleted'),
            ]);
        };

        paint();
        // * Typing repaints once the person pauses, not on every key.
        const listener = instance.onDidChangeModelContent(() => {
            closePopup();
            window.clearTimeout(timer);
            timer = window.setTimeout(paint, 300);
        });

        return () => {
            window.clearTimeout(timer);
            listener.dispose();
            click.dispose();
            closePopup();
            collection.clear();
        };
    }, [instance, baseline]);

    return (
        <Editor
            path={path}
            value={value}
            language={languageOf(path)}
            theme={monacoTheme()}
            loading={
                <p className="m-4 text-sm text-muted-foreground">Đang tải...</p>
            }
            onChange={(next) => onChange?.(next ?? '')}
            onMount={(editor, monaco) => {
                monacoRef.current = monaco;
                setInstance(editor);
                // * Copied lines are remembered with their file and line numbers: pasted into the chat they become a tag, not the raw code.
                editor.getDomNode()?.addEventListener('copy', () => {
                    const range = editor.getSelection();
                    const model = editor.getModel();

                    if (range === null || model === null || range.isEmpty()) {
                        return;
                    }

                    rememberCopied({
                        path: pathRef.current,
                        startLine: range.startLineNumber,
                        endLine: range.endLineNumber,
                        text: model.getValueInRange(range),
                    });
                });
                editor.addCommand(
                    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                    () => saveRef.current?.(),
                );
                editor.addAction({
                    id: 'pm.chat-about-selection',
                    label: 'Chat với AI về đoạn này',
                    contextMenuGroupId: '9_cutcopypaste',
                    contextMenuOrder: 0,
                    precondition: 'editorHasSelection',
                    run: (instance) => {
                        const range = instance.getSelection();
                        const model = instance.getModel();

                        if (range === null || model === null) {
                            return;
                        }

                        askRef.current?.({
                            startLine: range.startLineNumber,
                            // * A selection that ends at a line's very start does not include that line.
                            endLine:
                                range.endColumn === 1 &&
                                range.endLineNumber > range.startLineNumber
                                    ? range.endLineNumber - 1
                                    : range.endLineNumber,
                            text: model.getValueInRange(range),
                        });
                    },
                });
            }}
            options={{
                ...READ_ONLY_OPTIONS,
                readOnly: !editable,
                domReadOnly: !editable,
            }}
        />
    );
}
