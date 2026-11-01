import { isAxiosError } from 'axios';
import { Check } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { AiChatSettings } from '@/types';

// * Same limits as `AiChatSetting` / `SaveAiChatSettingsRequest`.
export const MAX_INSTRUCTIONS = 8000;
const MAX_DISPLAY_NAME = 60;
const MAX_ASSISTANT_NAME = 40;

export type PersonaErrors = Partial<
    Record<keyof AiChatSettings | 'avatar', string>
>;

export function FormField({
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
export function Choices({
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
                    <AssistantAvatar
                        imageUrl={settings.avatar_url}
                        icon={draft.assistant_icon}
                        color={draft.assistant_color}
                        vendor={vendor}
                        className="size-16"
                    />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="flex flex-wrap items-center gap-2">
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
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={uploading}
                                onClick={() => fileInput.current?.click()}
                            >
                                {uploading ? 'Đang tải...' : 'Tải ảnh lên'}
                            </Button>
                            {settings.avatar_url && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={uploading}
                                    onClick={() =>
                                        void sendImage(
                                            () =>
                                                api.delete(
                                                    '/ai-chat/settings/avatar',
                                                ),
                                            'Đã gỡ ảnh avatar.',
                                        )
                                    }
                                >
                                    Gỡ ảnh
                                </Button>
                            )}
                        </div>
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
