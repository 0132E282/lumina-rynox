import { ChatSettingsForm } from '@/components/ai-chat/chat-settings-form';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

/** * "Cài đặt chat" dialog (settings-style, fixed height so switching sections never jumps): the form mounts only while open, so cancelling always starts from the saved values. */
export function ChatSettingsDialog({
    open,
    onOpenChange,
    ...form
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
} & Omit<React.ComponentProps<typeof ChatSettingsForm>, 'onClose'>) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[min(90vh,52rem)] max-h-none w-[min(95vw,64rem)] flex-col sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Cài đặt chat</DialogTitle>
                    <DialogDescription>
                        Tùy chỉnh cách trợ lý trả lời và hiển thị. Các quy tắc
                        bảo mật và định dạng cố định luôn được giữ.
                    </DialogDescription>
                </DialogHeader>
                {open && (
                    <ChatSettingsForm
                        {...form}
                        onClose={() => onOpenChange(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
