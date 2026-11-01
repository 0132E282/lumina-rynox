import { isAxiosError } from 'axios';
import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { cvLatex } from '@/actions/App/Http/Controllers/AiController';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fillField } from '@/lib/fill-field';

/**
 * "AI viết CV bằng LaTeX" rewrites the CV text above into a LaTeX document and fills the `latex` field below it
 * (a direct child of the form, so FormLayout sees it); the person edits it and saves with the form.
 */
export function CvLatexButton() {
    const { getValues } = useFormContext();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();

    const generate = async () => {
        const content = String(getValues('content') ?? '').trim();

        if (content === '') {
            setError('Tải CV lên trước để AI có nội dung viết lại.');

            return;
        }

        setLoading(true);
        setError(undefined);

        try {
            const { data } = await api.post<{ latex: string }>(cvLatex.url(), {
                content,
            });

            fillField('latex', data.latex);
        } catch (caught) {
            setError(
                isAxiosError(caught) &&
                    typeof caught.response?.data?.message === 'string'
                    ? caught.response.data.message
                    : 'Không viết được CV dạng LaTeX, hãy thử lại.',
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex w-full flex-col gap-2">
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={loading}
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
                {loading ? 'AI đang viết…' : 'AI viết CV bằng LaTeX'}
            </Button>
            <InputError message={error} />
        </div>
    );
}
