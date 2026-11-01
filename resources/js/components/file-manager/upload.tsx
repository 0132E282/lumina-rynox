import { router } from '@inertiajs/react';
import { Upload } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';

export const ALLOWED_UPLOAD_ACCEPT =
    '.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,.mp3,.wav,.mp4,.mov,.webm';

export function useFileUpload(folderId: number | null) {
    return (fileList: FileList) => {
        const formData = new FormData();
        Array.from(fileList).forEach((file) =>
            formData.append('files[]', file),
        );

        if (folderId) {
            formData.append('parent_id', String(folderId));
        }

        router.post('/file-manager', formData, {
            forceFormData: true,
            onError: (errors) => {
                const message = Object.values(errors)[0];

                if (message) {
                    window.alert(message);
                }
            },
        });
    };
}

export function UploadButton({ folderId }: { folderId: number | null }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const upload = useFileUpload(folderId);

    return (
        <>
            <Button
                type="button"
                variant="outline"
                onClick={() => inputRef.current?.click()}
            >
                <Upload className="size-4" />
                Tải lên
            </Button>
            <input
                ref={inputRef}
                type="file"
                multiple
                accept={ALLOWED_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                        upload(e.target.files);
                    }

                    e.target.value = '';
                }}
            />
        </>
    );
}
