import {
    FileText,
    ImageIcon,
    Loader2,
    Mic,
    Paperclip,
    Plus,
    SendHorizontal,
    X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import InputError from '@/components/input-error';
import { EmojiPicker } from '@/components/chat/emoji-picker';
import { useLinkPreview } from '@/hooks/use-link-preview';
import { cn } from '@/lib/utils';

type ComposerProps = {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    sending: boolean;
    disabled: boolean;
    disabledReason: string;
    error?: string;
    /** * Files waiting to be sent (one message each, the caption goes with the first). */
    files: File[];
    onFilesChange: (files: File[]) => void;
    /** * Shows the microphone button (voice messages); only channels that can send them. */
    canRecord?: boolean;
    /** * Fills the box with an AI draft; omitted when the user cannot reply. */
};

const MAX_FILES = 10;

const formatSize = (bytes: number) =>
    bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function ImageThumb({
    file,
    disabled,
    onRemove,
}: {
    file: File;
    disabled: boolean;
    onRemove: () => void;
}) {
    const url = useMemo(() => URL.createObjectURL(file), [file]);

    // * The preview lives in memory only; it is released when the file leaves the list.
    useEffect(() => () => URL.revokeObjectURL(url), [url]);

    return (
        <div className="relative size-20 shrink-0 overflow-hidden rounded-[14px] border bg-muted">
            <img
                src={url}
                alt={file.name}
                title={file.name}
                className="size-full object-cover"
            />
            <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute top-1 right-1 size-5 rounded-full"
                disabled={disabled}
                aria-label={`Bỏ ${file.name}`}
                onClick={onRemove}
            >
                <X aria-hidden="true" className="size-3" />
            </Button>
        </div>
    );
}

/** * Enter sends, Shift+Enter adds a line. The button and Enter are locked while a send is in flight. */
export function Composer({
    value,
    onChange,
    onSubmit,
    sending,
    disabled,
    disabledReason,
    error,
    files,
    onFilesChange,
    canRecord = false,
}: ComposerProps) {
    const errorId = useId();
    const { preview: linkPreview, dismiss: dismissLinkPreview } =
        useLinkPreview(value, !disabled);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const imageInput = useRef<HTMLInputElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const recorder = useRef<MediaRecorder | null>(null);
    const recordingCancelled = useRef(false);
    const [recordingSeconds, setRecordingSeconds] = useState<number | null>(
        null,
    );
    const [recordError, setRecordError] = useState<string>();
    const recording = recordingSeconds !== null;

    // * The timer ticks while a recording is running.
    useEffect(() => {
        if (!recording) {
            return;
        }

        const timer = window.setInterval(
            () => setRecordingSeconds((seconds) => (seconds ?? 0) + 1),
            1000,
        );

        return () => window.clearInterval(timer);
    }, [recording]);

    // * Leaving the conversation releases the microphone.
    useEffect(
        () => () => {
            recordingCancelled.current = true;
            recorder.current?.stop();
        },
        [],
    );

    const startRecording = async () => {
        setRecordError(undefined);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });
            const media = new MediaRecorder(stream);
            const chunks: Blob[] = [];

            recordingCancelled.current = false;
            media.ondataavailable = (event) => chunks.push(event.data);
            media.onstop = () => {
                stream.getTracks().forEach((track) => track.stop());
                setRecordingSeconds(null);
                recorder.current = null;

                if (recordingCancelled.current || chunks.length === 0) {
                    return;
                }

                const type = (media.mimeType || 'audio/webm').split(';')[0];
                const extension = type.includes('ogg')
                    ? 'ogg'
                    : type.includes('mp4')
                      ? 'm4a'
                      : 'webm';

                onFilesChange(
                    [
                        ...filesRef.current,
                        new File(
                            [new Blob(chunks, { type })],
                            `voice-${Date.now()}.${extension}`,
                            { type },
                        ),
                    ].slice(0, MAX_FILES),
                );
            };
            media.start();
            recorder.current = media;
            setRecordingSeconds(0);
        } catch {
            setRecordError(
                'Không mở được micro. Hãy cho phép trình duyệt dùng micro.',
            );
        }
    };

    const stopRecording = (cancel: boolean) => {
        recordingCancelled.current = cancel;
        recorder.current?.stop();
    };
    const filesRef = useRef(files);
    filesRef.current = files;
    const imageCount = files.filter((file) =>
        file.type.startsWith('image/'),
    ).length;
    const canSubmit =
        !disabled && !sending && (value.trim() !== '' || files.length > 0);

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        // * `isComposing` keeps Enter from sending while an IME (Vietnamese Telex/VNI) is still composing.
        if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
        ) {
            event.preventDefault();

            if (canSubmit) {
                onSubmit();
            }
        }
    };

    // * Inserts at the caret (or replaces the selection) and puts the caret back after the emoji.
    const insertEmoji = (emoji: string) => {
        const field = textarea.current;
        const start = field?.selectionStart ?? value.length;
        const end = field?.selectionEnd ?? value.length;
        const next = value.slice(0, start) + emoji + value.slice(end);

        if (next.length > 4096) {
            return;
        }

        onChange(next);
        requestAnimationFrame(() => {
            field?.focus();
            field?.setSelectionRange(
                start + emoji.length,
                start + emoji.length,
            );
        });
    };

    const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
        onFilesChange(
            [...files, ...Array.from(event.target.files ?? [])].slice(
                0,
                MAX_FILES,
            ),
        );
        // * Lets the same file be picked again after it was removed.
        event.target.value = '';
    };

    return (
        <form
            className="flex flex-col gap-1 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            onSubmit={(event) => {
                event.preventDefault();

                if (canSubmit) {
                    onSubmit();
                }
            }}
        >
            <div className="flex items-center gap-1">
                <EmojiPicker disabled={disabled} onPick={insertEmoji} />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled || sending}
                    aria-label="Gửi ảnh"
                    onClick={() => imageInput.current?.click()}
                >
                    <ImageIcon aria-hidden="true" className="size-5" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled || sending}
                    aria-label="Đính kèm file"
                    onClick={() => fileInput.current?.click()}
                >
                    <Paperclip aria-hidden="true" className="size-5" />
                </Button>
                {canRecord && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled || sending || recording}
                        aria-label="Ghi âm tin nhắn thoại"
                        title="Ghi âm tin nhắn thoại"
                        onClick={() => void startRecording()}
                    >
                        <Mic aria-hidden="true" className="size-5" />
                    </Button>
                )}
                <input
                    ref={imageInput}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    multiple
                    className="hidden"
                    onChange={pickFile}
                />
                <input
                    ref={fileInput}
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                    multiple
                    className="hidden"
                    onChange={pickFile}
                />
            </div>
            {linkPreview !== null && (
                <div className="flex items-start gap-3 rounded-[14px] bg-muted p-2">
                    {linkPreview.image !== null && (
                        <img
                            src={linkPreview.image}
                            alt=""
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            className="size-16 shrink-0 rounded-md object-cover"
                        />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col text-sm">
                        <span className="truncate font-semibold">
                            {linkPreview.title ?? linkPreview.host}
                        </span>
                        {linkPreview.description !== null && (
                            <span className="line-clamp-2 text-xs text-muted-foreground">
                                {linkPreview.description}
                            </span>
                        )}
                        <span className="truncate text-xs text-primary">
                            {linkPreview.host}
                        </span>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label="Ẩn xem trước liên kết"
                        onClick={dismissLinkPreview}
                    >
                        <X aria-hidden="true" className="size-4" />
                    </Button>
                </div>
            )}
            <div className="flex items-end gap-2">
                <textarea
                    ref={textarea}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    rows={1}
                    maxLength={4096}
                    aria-label="Nhập tin nhắn"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    placeholder={disabled ? disabledReason : 'Nhập tin nhắn…'}
                    className={cn(
                        '[field-sizing:content] max-h-36 min-h-10 w-full resize-none rounded-sm bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground md:text-sm',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                />
                <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label={sending ? 'Đang gửi' : 'Gửi'}
                    title="Gửi (Enter)"
                    className="size-10 text-primary hover:bg-transparent hover:text-primary/80"
                    disabled={!canSubmit}
                >
                    {sending ? (
                        <Loader2
                            aria-hidden="true"
                            className="size-5 motion-safe:animate-spin"
                        />
                    ) : (
                        <SendHorizontal aria-hidden="true" className="size-5" />
                    )}
                </Button>
            </div>
            {imageCount > 0 && (
                <div className="flex flex-col gap-2 py-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{imageCount} ảnh</span>
                        <button
                            type="button"
                            className="hover:text-foreground disabled:opacity-50"
                            disabled={sending}
                            onClick={() =>
                                onFilesChange(
                                    files.filter(
                                        (file) =>
                                            !file.type.startsWith('image/'),
                                    ),
                                )
                            }
                        >
                            Xoá tất cả
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {files.map((file, index) =>
                            file.type.startsWith('image/') ? (
                                <ImageThumb
                                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                                    file={file}
                                    disabled={sending}
                                    onRemove={() =>
                                        onFilesChange(
                                            files.filter((_, i) => i !== index),
                                        )
                                    }
                                />
                            ) : null,
                        )}
                        {files.length < MAX_FILES && (
                            <button
                                type="button"
                                aria-label="Thêm ảnh"
                                disabled={sending}
                                className="flex size-20 shrink-0 items-center justify-center rounded-[14px] border border-dashed bg-muted/40 text-muted-foreground hover:bg-muted disabled:opacity-50"
                                onClick={() => imageInput.current?.click()}
                            >
                                <Plus aria-hidden="true" className="size-6" />
                            </button>
                        )}
                    </div>
                </div>
            )}
            {files.some((file) => !file.type.startsWith('image/')) && (
                <div className="flex flex-wrap gap-2 py-1">
                    {files.map((file, index) =>
                        file.type.startsWith('image/') ? null : (
                            <div
                                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                                title={file.name}
                                className="flex h-10 max-w-64 items-center gap-2 rounded-[14px] border bg-muted/40 pr-1 pl-2.5"
                            >
                                <FileText
                                    aria-hidden="true"
                                    className="size-4 shrink-0 text-muted-foreground"
                                />
                                <span className="min-w-0 truncate text-sm">
                                    {file.name}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {formatSize(file.size)}
                                </span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-6 shrink-0 rounded-full"
                                    disabled={sending}
                                    aria-label={`Bỏ ${file.name}`}
                                    onClick={() =>
                                        onFilesChange(
                                            files.filter((_, i) => i !== index),
                                        )
                                    }
                                >
                                    <X aria-hidden="true" className="size-4" />
                                </Button>
                            </div>
                        ),
                    )}
                </div>
            )}
            {recording && (
                <div className="flex items-center gap-3 rounded-full border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm">
                    <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse"
                    />
                    <span className="flex-1 tabular-nums">
                        Đang ghi âm {Math.floor((recordingSeconds ?? 0) / 60)}:
                        {String((recordingSeconds ?? 0) % 60).padStart(2, '0')}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => stopRecording(true)}
                    >
                        Huỷ
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => stopRecording(false)}
                    >
                        Xong
                    </Button>
                </div>
            )}
            {recordError && (
                <p className="text-sm text-destructive">{recordError}</p>
            )}
            <div id={errorId}>
                <InputError message={error} />
            </div>
        </form>
    );
}
