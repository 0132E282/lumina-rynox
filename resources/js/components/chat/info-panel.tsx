import { usePage } from '@inertiajs/react';
import { ImageIcon } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
    CHAT_BACKGROUND_PRESETS,
    readBackgroundFile,
    useChatBackground,
} from '@/hooks/use-chat-background';
import { useInitials } from '@/hooks/use-initials';
import type { ChatChannel, Conversation } from '@/types';
import { ChannelBadge } from './channel-badge';

const STATUS_LABEL: Record<ChatChannel['status'], string> = {
    connected: 'Hoạt động',
    error: 'Mất kết nối',
    disconnected: 'Chưa kết nối',
};

/** * Minimal contact panel for wide desktops: who the customer is and which account the chat goes through. */
export function InfoPanel({
    conversation,
    channel,
}: {
    conversation: Conversation;
    channel: ChatChannel;
}) {
    const getInitials = useInitials();
    const [background, setBackground] = useChatBackground(conversation.id);
    const backgroundInput = useRef<HTMLInputElement>(null);

    const pickBackground = async (file: File | undefined) => {
        if (file === undefined) {
            return;
        }

        try {
            if (!setBackground(await readBackgroundFile(file))) {
                toast.error('Không lưu được ảnh nền, hãy thử ảnh nhỏ hơn.');
            }
        } catch {
            toast.error('Tệp này không phải ảnh hợp lệ.');
        }
    };
    const account =
        channel.display_name ??
        channel.bot_username ??
        conversation.account?.name ??
        channel.account;

    return (
        <aside
            aria-label="Thông tin hội thoại"
            className="flex h-full w-full flex-col gap-6 overflow-y-auto p-4"
        >
            <div className="flex flex-col items-center gap-2 text-center">
                <span className="relative">
                    <Avatar size="lg">
                        <AvatarImage
                            src={conversation.avatar_url ?? undefined}
                            alt=""
                        />
                        <AvatarFallback aria-hidden="true">
                            {getInitials(conversation.title)}
                        </AvatarFallback>
                    </Avatar>
                    <ChannelBadge
                        provider={channel.provider}
                        className="absolute -right-1 -bottom-1"
                    />
                </span>
                <p className="text-sm font-semibold break-words">
                    {conversation.title}
                </p>
            </div>

            <dl className="flex flex-col gap-3 text-sm">
                <div>
                    <dt className="text-xs text-muted-foreground">Loại chat</dt>
                    <dd>
                        {conversation.type === 'group' ? 'Nhóm' : 'Cá nhân'}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-muted-foreground">
                        Tài khoản kết nối
                    </dt>
                    <dd>
                        {channel.name}
                        {account ? ` · ${account}` : ''}
                        <br />
                        <span className="text-muted-foreground">
                            {STATUS_LABEL[channel.status]}
                        </span>
                    </dd>
                </div>
            </dl>

            <section className="flex flex-col gap-2">
                <h3 className="text-xs text-muted-foreground">Ảnh nền</h3>
                <div className="flex flex-wrap gap-2">
                    {CHAT_BACKGROUND_PRESETS.map((preset) => (
                        <button
                            key={preset.value}
                            type="button"
                            title={preset.label}
                            aria-label={`Nền ${preset.label}`}
                            aria-pressed={background === preset.value}
                            onClick={() => setBackground(preset.value)}
                            style={{ background: preset.value }}
                            className="size-9 rounded-md border aria-pressed:ring-2 aria-pressed:ring-primary"
                        />
                    ))}
                </div>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => backgroundInput.current?.click()}
                    >
                        <ImageIcon aria-hidden="true" />
                        Chọn ảnh
                    </Button>
                    {background !== null && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setBackground(null)}
                        >
                            Mặc định
                        </Button>
                    )}
                </div>
                <input
                    ref={backgroundInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(event) => {
                        void pickBackground(event.target.files?.[0]);
                        event.target.value = '';
                    }}
                />
            </section>
        </aside>
    );
}
