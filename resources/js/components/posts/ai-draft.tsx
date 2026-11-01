import { isAxiosError } from 'axios';
import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { postDraft } from '@/actions/App/Http/Controllers/AiController';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

/**
 * "Viết bằng AI" beside the post body: a short idea goes to the AI, the draft comes back into the body for the person to edit.
 * Nothing is posted or saved from here; a draft replaces the body only after the person asked for it.
 */
export function AiDraft({
    onDraft,
    disabled,
}: {
    onDraft: (draft: { title: string | null; body: string }) => void;
    disabled: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [idea, setIdea] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();

    const generate = async () => {
        setLoading(true);
        setError(undefined);

        try {
            const { data } = await api.post<{
                title: string | null;
                draft: string;
            }>(postDraft.url(), { idea: idea.trim() });

            onDraft({ title: data.title, body: data.draft });
            setOpen(false);
            setIdea('');
        } catch (caught) {
            setError(
                isAxiosError(caught) &&
                    typeof caught.response?.data?.message === 'string'
                    ? caught.response.data.message
                    : 'Không viết được bài, hãy thử lại.',
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={disabled}
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                <Sparkles aria-hidden="true" />
                Viết bằng AI
            </Button>
            {open && (
                <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                    <label
                        htmlFor="post-ai-idea"
                        className="text-sm font-medium"
                    >
                        Ý tưởng bài viết
                    </label>
                    <textarea
                        id="post-ai-idea"
                        value={idea}
                        maxLength={2000}
                        rows={3}
                        onChange={(event) => setIdea(event.target.value)}
                        placeholder="Ví dụ: giới thiệu khoá học NestJS cho người mới, giọng thân thiện, kèm lời kêu gọi đăng ký"
                        className="w-full rounded-sm border border-input bg-card px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                    />
                    <InputError message={error} />
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                            AI điền tiêu đề và nội dung, thay phần hiện tại. Bạn
                            chỉnh lại trước khi đăng.
                        </span>
                        <Button
                            type="button"
                            size="sm"
                            disabled={loading || idea.trim() === ''}
                            onClick={() => void generate()}
                        >
                            {loading ? (
                                <Loader2
                                    aria-hidden="true"
                                    className="motion-safe:animate-spin"
                                />
                            ) : (
                                <Sparkles aria-hidden="true" />
                            )}
                            {loading ? 'Đang viết…' : 'Viết bài'}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
