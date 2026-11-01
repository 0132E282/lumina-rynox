import { isAxiosError } from 'axios';
import { Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { extractCv } from '@/actions/App/Http/Controllers/AiController';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fillField } from '@/lib/fill-field';

type Extracted = {
    text: string;
    position: string | null;
    keywords: string[];
    file_path: string | null;
};

/**
 * "Tải CV lên": the file's text goes to the AI, which reads the position, keywords and experience back into the CV form.
 * Nothing is saved from here; the person reviews the filled fields and saves the form as usual. The file itself is not kept.
 */
export function CvAiUpload() {
    const { setValue, getValues } = useFormContext();
    const input = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();
    const [done, setDone] = useState<string>();

    const fill = (name: string, value: string | null) => {
        if (value === null || value === '') {
            return;
        }

        // * `setValue` is the fallback when the input is not on screen.
        if (!fillField(name, value)) {
            setValue(name, value, { shouldDirty: true, shouldValidate: true });
        }
    };

    const upload = async (file: File) => {
        setLoading(true);
        setError(undefined);
        setDone(undefined);

        try {
            const body = new FormData();
            body.append('file', file);

            const { data } = await api.post<Extracted>(extractCv.url(), body);

            if (!getValues('name')) {
                fill('name', file.name.replace(/\.[^.]+$/, ''));
            }

            fill('desired_position', data.position);
            fill('position', data.keywords.join(' · '));
            fill('content', data.text);
            fill('file_path', data.file_path);
            setDone(
                data.keywords.length > 0
                    ? `Đã đọc "${file.name}" (${data.text.length} ký tự), từ khoá: ${data.keywords.join(', ')}. Kiểm tra lại các ô bên dưới rồi lưu.`
                    : `Đã đọc "${file.name}" (${data.text.length} ký tự) nhưng AI chưa đề xuất được từ khoá: hãy tự nhập ô "Từ khoá tìm kiếm".`,
            );
        } catch (caught) {
            setError(
                isAxiosError(caught) &&
                    typeof caught.response?.data?.message === 'string'
                    ? caught.response.data.message
                    : `Không đọc được CV (${isAxiosError(caught) ? (caught.response?.status ?? 'không kết nối được máy chủ') : 'lỗi giao diện'}), hãy thử lại.`,
            );
        } finally {
            setLoading(false);

            if (input.current) {
                input.current.value = '';
            }
        }
    };

    return (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
            <input
                ref={input}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="sr-only"
                aria-label="Chọn file CV để AI đọc"
                onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (file) {
                        void upload(file);
                    }
                }}
            />
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={loading}
                onClick={() => input.current?.click()}
            >
                {loading ? (
                    <Loader2
                        aria-hidden="true"
                        className="motion-safe:animate-spin"
                    />
                ) : (
                    <Upload aria-hidden="true" />
                )}
                {loading ? 'AI đang đọc CV…' : 'Tải CV lên để AI đọc'}
            </Button>
            <p className="text-xs text-muted-foreground">
                PDF, DOCX, TXT hoặc MD, tối đa 5 MB. AI điền tên, vị trí ứng
                tuyển và từ khoá tìm kiếm vào các ô bên dưới (thay giá trị hiện
                có); bạn chỉnh lại rồi mới lưu. PDF dạng ảnh scan chưa đọc được.
            </p>
            <InputError message={error} />
            {done && (
                <p className="text-sm text-green-700 dark:text-green-400">
                    {done}
                </p>
            )}
        </div>
    );
}
