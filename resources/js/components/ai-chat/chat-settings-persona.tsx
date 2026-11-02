import { isAxiosError } from 'axios';
import { Check, Mic, Trash2, Upload, Volume2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Field } from '@/components/form';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { avatarUploadError, prepareAvatarFile } from '@/lib/avatar-image';
import { ASSISTANT_COLORS, ASSISTANT_ICONS } from '@/lib/assistant-avatar';
import {
    canSpeak,
    cloneVoice,
    cloudPrefix,
    previewVoice,
    removeVoice,
    useSpeech,
} from '@/lib/speak';
import { cn } from '@/lib/utils';
import type { AiChatSettings } from '@/types';

// * Same limits as `AiChatSetting` / `SaveAiChatSettingsRequest`.
const MAX_INSTRUCTIONS = 8000;
const MAX_DISPLAY_NAME = 60;
const MAX_ASSISTANT_NAME = 40;

export type PersonaErrors = Partial<
    Record<keyof AiChatSettings | 'avatar', string>
>;

function FormField({
    label,
    htmlFor,
    error,
    hint,
    children,
}: {
    label: string;
    htmlFor?: string;
    error?: string;
    hint?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            <InputError message={error} />
        </div>
    );
}

/** * Choice buttons of a fixed list, announced as a radio group. */
function Choices({
    label,
    value,
    onChange,
    options,
    disabled,
}: {
    label: string;
    value: string | null;
    onChange: (value: string | null) => void;
    options: { key: string | null; label: string; node: ReactNode }[];
    disabled?: boolean;
}) {
    return (
        <div
            role="radiogroup"
            aria-label={label}
            className={cn('flex flex-wrap gap-1.5', disabled && 'opacity-50')}
        >
            {options.map((option) => (
                <button
                    key={option.key ?? 'default'}
                    type="button"
                    role="radio"
                    aria-checked={value === option.key}
                    aria-label={option.label}
                    title={option.label}
                    disabled={disabled}
                    onClick={() => onChange(option.key)}
                    className={cn(
                        'flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        value === option.key
                            ? 'border-primary bg-accent'
                            : 'hover:bg-muted',
                    )}
                >
                    {option.node}
                </button>
            ))}
        </div>
    );
}

/** * Tab "Cài đặt nhân vật": own instructions, names and the assistant's avatar (upload, icon or vendor logo). The text fields are saved with the dialog's "Lưu"; the image uploads at once. */
function VoiceButton({
    label,
    selected,
    playing,
    onPick,
    onRemove,
}: {
    label: string;
    selected: boolean;
    playing: boolean;
    onPick: () => void;
    onRemove?: () => void;
}) {
    return (
        <span className="inline-flex">
            <Button
                type="button"
                role="radio"
                aria-checked={selected}
                variant="outline"
                size="sm"
                onClick={onPick}
                className={cn(
                    onRemove && 'rounded-r-none',
                    selected &&
                        'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
                )}
            >
                {selected && playing ? (
                    <Volume2
                        aria-hidden="true"
                        className="animate-pulse motion-reduce:animate-none"
                    />
                ) : selected ? (
                    <Check aria-hidden="true" />
                ) : null}
                {label}
            </Button>
            {onRemove && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Xoá giọng ${label}`}
                    title="Xoá giọng này"
                    onClick={onRemove}
                    className="rounded-l-none border-l-0 px-2 text-muted-foreground"
                >
                    <Trash2 aria-hidden="true" />
                </Button>
            )}
        </span>
    );
}

/** * Makes a voice of the person's own: a name, a recording (uploaded or recorded here) and their confirmation that the voice is theirs to use. */
function CloneVoice() {
    const [name, setName] = useState('');
    const [sample, setSample] = useState<Blob | null>(null);
    const [consent, setConsent] = useState(false);
    const [recording, setRecording] = useState<MediaRecorder | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const record = async () => {
        if (recording !== null) {
            recording.stop();

            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });
            const recorder = new MediaRecorder(stream);
            const parts: Blob[] = [];

            recorder.ondataavailable = (event) => parts.push(event.data);
            recorder.onstop = () => {
                stream.getTracks().forEach((track) => track.stop());
                setSample(new Blob(parts, { type: recorder.mimeType }));
                setRecording(null);
            };
            recorder.start();
            setRecording(recorder);
        } catch {
            setError('Không dùng được micro.');
        }
    };

    const create = async () => {
        if (sample === null) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            await cloneVoice(name.trim(), sample, consent);
            setName('');
            setSample(null);
            setConsent(false);
            toast.success('Đã tạo giọng của bạn.');
        } catch (caught) {
            setError(
                isAxiosError(caught) && caught.response?.data?.message
                    ? String(caught.response.data.message)
                    : 'Không tạo được giọng.',
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
            <Label>Tạo giọng của tôi</Label>
            <p className="text-sm text-muted-foreground">
                Thu hoặc tải lên khoảng 1 đến 3 phút giọng nói rõ, ít tiếng ồn.
                Bản thu được gửi tới dịch vụ giọng đọc để tạo giọng.
            </p>
            <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                placeholder="Tên giọng"
                aria-label="Tên giọng"
                className="h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void record()}
                >
                    <Mic aria-hidden="true" />
                    {recording !== null ? 'Dừng thu' : 'Thu giọng'}
                </Button>
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent">
                    <Upload aria-hidden="true" className="size-4" />
                    Tải tệp âm thanh
                    <input
                        type="file"
                        accept="audio/*"
                        className="sr-only"
                        onChange={(event) =>
                            setSample(event.target.files?.[0] ?? null)
                        }
                    />
                </label>
                {sample !== null && (
                    <span className="text-sm text-muted-foreground">
                        Đã có bản thu (
                        {Math.max(1, Math.round(sample.size / 1024))} KB)
                    </span>
                )}
            </div>
            <label className="flex items-start gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    className="mt-1"
                />
                Đây là giọng của chính tôi, hoặc tôi được chủ giọng cho phép
                dùng.
            </label>
            {error !== null && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <Button
                type="button"
                size="sm"
                className="self-start"
                disabled={
                    busy || sample === null || !consent || name.trim() === ''
                }
                onClick={() => void create()}
            >
                {busy ? 'Đang tạo…' : 'Tạo giọng'}
            </Button>
        </div>
    );
}

/** * Voice that reads the character's answers aloud: the service's sample voices, the person's own, and the device's. A click picks one and plays a short sample. Kept in this browser. */
function VoicePicker() {
    const { voice, voices, cloud, speaking } = useSpeech();

    if (!canSpeak() && cloud.length === 0) {
        return null;
    }

    const playing = speaking === 'voice-sample';
    const current = voice ?? voices[0] ?? null;
    const samples = cloud.filter((item) => !item.own);
    const own = cloud.filter((item) => item.own);

    return (
        <div className="flex flex-col gap-3">
            <Label>Giọng đọc</Label>
            <div
                role="radiogroup"
                aria-label="Giọng đọc của nhân vật"
                className="flex flex-col gap-3"
            >
                {[
                    { title: 'Giọng mẫu', items: samples },
                    { title: 'Giọng của tôi', items: own },
                ].map(
                    (group) =>
                        group.items.length > 0 && (
                            <div
                                key={group.title}
                                className="flex flex-col gap-1.5"
                            >
                                <span className="text-xs font-medium text-muted-foreground">
                                    {group.title}
                                </span>
                                <div className="flex flex-wrap gap-2">
                                    {group.items.map((item) => (
                                        <VoiceButton
                                            key={item.id}
                                            label={item.name}
                                            selected={
                                                current ===
                                                cloudPrefix + item.id
                                            }
                                            playing={playing}
                                            onPick={() =>
                                                previewVoice(
                                                    cloudPrefix + item.id,
                                                )
                                            }
                                            onRemove={
                                                item.own
                                                    ? () =>
                                                          void removeVoice(
                                                              item.id,
                                                          )
                                                    : undefined
                                            }
                                        />
                                    ))}
                                </div>
                            </div>
                        ),
                )}
                {voices.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                            Giọng trên máy
                        </span>
                        <div className="flex flex-wrap gap-2">
                            {voices.map((name) => (
                                <VoiceButton
                                    key={name}
                                    label={name}
                                    selected={current === name}
                                    playing={playing}
                                    onPick={() => previewVoice(name)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
            <p className="text-sm text-muted-foreground">
                Bấm một giọng để nghe thử. Giọng được nhớ trong trình duyệt này.
            </p>
            {cloud.length > 0 ? (
                <CloneVoice />
            ) : (
                <p className="text-sm text-muted-foreground">
                    Muốn có giọng mẫu và tạo giọng của riêng bạn: thêm{' '}
                    <code>ELEVENLABS_API_KEY</code> vào <code>.env</code>.
                </p>
            )}
        </div>
    );
}

export function ChatSettingsPersona({
    draft,
    onChange,
    settings,
    onSettingsChange,
    accountName,
    vendor,
    errors,
    busy,
    onReset,
}: {
    draft: AiChatSettings;
    onChange: <Key extends keyof AiChatSettings>(
        key: Key,
        value: AiChatSettings[Key],
    ) => void;
    /** Saved settings: the uploaded image lives here, not in the draft. */
    settings: AiChatSettings;
    onSettingsChange: (settings: AiChatSettings) => void;
    accountName: string;
    vendor?: { key: string; name: string };
    errors: PersonaErrors;
    busy: boolean;
    onReset: () => void;
}) {
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [showTools, setShowTools] = useState(false);
    const [avatarError, setAvatarError] = useState<string | undefined>();
    const instructions = useWatch({ name: 'custom_instructions' }) ?? '';

    const sendImage = async (
        request: () => Promise<{ data: { settings: AiChatSettings } }>,
        success: string,
    ) => {
        setUploading(true);
        setAvatarError(undefined);

        try {
            const { data } = await request();

            onSettingsChange(data.settings);
            toast.success(success);
        } catch (caught) {
            if (!isAxiosError(caught)) {
                // * Raised by prepareAvatarFile with a Vietnamese message.
                setAvatarError(
                    caught instanceof Error
                        ? caught.message
                        : 'Không cập nhật được ảnh.',
                );

                return;
            }

            const data = caught.response?.data as
                { errors?: { avatar?: string[] } } | undefined;

            setAvatarError(
                avatarUploadError(
                    caught.response?.status,
                    data?.errors?.avatar?.[0],
                ),
            );
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <FormField
                label="Avatar trợ lý"
                error={
                    avatarError ??
                    errors.avatar ??
                    errors.assistant_icon ??
                    errors.assistant_color
                }
                hint="Ảnh tải lên (jpg, png, webp, gif, tối đa 1 MB) được ưu tiên hơn biểu tượng và logo. Avatar của bạn là ảnh hồ sơ hoặc chữ cái đầu của tên."
            >
                <div className="flex items-start gap-3">
                    {/* * Click (or focus) the image to reveal the upload and remove icons over it; the icon and color choices sit beside it. */}
                    <div className="group relative shrink-0">
                        <input
                            ref={fileInput}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="sr-only"
                            aria-label="Chọn ảnh avatar"
                            tabIndex={-1}
                            onChange={(event) => {
                                const file = event.target.files?.[0];

                                event.target.value = '';

                                if (file) {
                                    void sendImage(async () => {
                                        const form = new FormData();

                                        form.append(
                                            'avatar',
                                            await prepareAvatarFile(file),
                                        );

                                        return api.post(
                                            '/ai-chat/settings/avatar',
                                            form,
                                        );
                                    }, 'Đã cập nhật ảnh avatar.');
                                }
                            }}
                        />
                        <AssistantAvatar
                            imageUrl={settings.avatar_url}
                            icon={draft.assistant_icon}
                            color={draft.assistant_color}
                            vendor={vendor}
                            className="size-16"
                        />
                        <div
                            className={cn(
                                'absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-black/60 text-white transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                                showTools || uploading
                                    ? 'opacity-100'
                                    : 'opacity-0',
                            )}
                        >
                            <button
                                type="button"
                                aria-label="Tải ảnh lên"
                                title="Tải ảnh lên"
                                disabled={uploading}
                                onClick={() => fileInput.current?.click()}
                                className="rounded-full p-1.5 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
                            >
                                <Upload className="size-4" aria-hidden="true" />
                            </button>
                        </div>
                        {/* * Touch screens have no hover: tapping the image toggles the icons. */}
                        <button
                            type="button"
                            aria-label="Đổi ảnh avatar"
                            aria-expanded={showTools}
                            onClick={() => setShowTools((value) => !value)}
                            className="absolute inset-0 -z-0 rounded-full group-hover:hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                        <Choices
                            label="Biểu tượng"
                            value={draft.assistant_icon}
                            onChange={(value) =>
                                onChange('assistant_icon', value)
                            }
                            options={[
                                {
                                    key: null,
                                    label: 'Logo nhà cung cấp',
                                    node: 'Logo',
                                },
                                ...Object.entries(ASSISTANT_ICONS).map(
                                    ([key, { label, icon: Icon }]) => ({
                                        key,
                                        label,
                                        node: (
                                            <Icon
                                                className="size-4"
                                                aria-hidden="true"
                                            />
                                        ),
                                    }),
                                ),
                            ]}
                        />
                        <Choices
                            label="Màu nền"
                            value={draft.assistant_color}
                            onChange={(value) =>
                                onChange('assistant_color', value)
                            }
                            options={[
                                {
                                    key: null,
                                    label: 'Màu mặc định',
                                    node: (
                                        <Check
                                            className="size-4 opacity-0"
                                            aria-hidden="true"
                                        />
                                    ),
                                },
                                ...Object.entries(ASSISTANT_COLORS).map(
                                    ([key, { label, className }]) => ({
                                        key,
                                        label,
                                        node: (
                                            <span
                                                aria-hidden="true"
                                                className={cn(
                                                    'size-4 rounded-full',
                                                    className,
                                                )}
                                            />
                                        ),
                                    }),
                                ),
                            ]}
                        />
                    </div>
                </div>
            </FormField>
            {/* * Text fields use the shared `Field` (react-hook-form context from the dialog); server errors arrive through setError. */}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field
                    name="display_name"
                    label="Tên AI gọi bạn"
                    maxLength={MAX_DISPLAY_NAME}
                    placeholder={accountName}
                />
                <Field
                    name="assistant_name"
                    label="Tên trợ lý"
                    maxLength={MAX_ASSISTANT_NAME}
                    placeholder="Trợ lý AI"
                />
            </div>

            <VoicePicker />

            <div className="flex flex-col gap-1">
                <Field
                    name="custom_instructions"
                    ui="textarea"
                    label="Chỉ dẫn riêng"
                    maxLength={MAX_INSTRUCTIONS}
                    placeholder="Ví dụ: Trả lời ngắn gọn, ưu tiên ví dụ bằng PHP."
                    description={`${instructions.length} / ${MAX_INSTRUCTIONS} ký tự. Được thêm sau các quy tắc cố định về bảo mật và định dạng, không thay thế chúng.`}
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 self-start px-2 text-muted-foreground"
                    disabled={busy}
                    onClick={onReset}
                >
                    Khôi phục mặc định
                </Button>
            </div>
        </div>
    );
}
