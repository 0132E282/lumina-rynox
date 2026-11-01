import { Columns2, Copy } from 'lucide-react';
import {
    useFormCollection,
    useFormRecordId,
} from '@/components/form/collection-context';
import { useSplitView } from '@/components/form/split-view-context';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/contexts/locale-context';
import { useQuery } from '@/hooks/use-query';

/** * Public page link from `/items/{collection}/{id}/frontend-url`; hidden for unsaved records or resources without `FRONTEND_URL`. */
export default function FrontendUrl() {
    const collection = useFormCollection();
    const id = useFormRecordId();
    // * Passed so switching locale refetches links built from translatable columns.
    const [locale] = useLocale();
    const splitView = useSplitView();

    const { data } = useQuery<{ data: { url: string } }>(
        collection && id ? 'items.frontend-url' : null,
        { resource: collection, id, locale },
    );
    const url = data?.data.url;

    if (!url) {
        return null;
    }

    return (
        <div className="-mt-2 flex items-center gap-2 py-1 text-sm">
            <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 truncate font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
                {url}
            </a>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => navigator.clipboard.writeText(url)}
            >
                <Copy className="size-3.5" />
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                title="Xem chia đôi màn hình"
                onClick={() => splitView?.open(url)}
            >
                <Columns2 className="size-3.5" />
            </Button>
        </div>
    );
}
