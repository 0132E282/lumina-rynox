import { Link, router, usePage } from '@inertiajs/react';
import { ChevronRight, DatabaseZap, FolderPlus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConfirm } from '@/components/confirm-dialog';
import { formatSize } from '@/components/file-manager/format';
import { UploadButton } from '@/components/file-manager/upload';
import { usePrompt } from '@/components/prompt-dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useHeaderActionsSlot } from '@/contexts/header-actions';
import { useLocale } from '@/contexts/locale-context';
import type { LocaleOption } from '@/contexts/locale-context';

type FileManagerCrumb = { id: number; name: string };

type FileManagerHeaderProps = {
    breadcrumbs?: FileManagerCrumb[];
    folderId?: number | null;
    cacheSize?: number;
    locales?: LocaleOption[];
};

export function SiteHeader() {
    const { props } = usePage<
        FileManagerHeaderProps & { canUseAi?: boolean }
    >();
    const breadcrumbs = props.breadcrumbs;
    const confirm = useConfirm();
    const prompt = usePrompt();
    const headerActions = useHeaderActionsSlot();
    const [locale, setLocale] = useLocale();

    const isFileManager = props.cacheSize !== undefined;
    const folderId = props.folderId ?? null;
    const cacheSize = props.cacheSize ?? 0;

    // ! Read the last <title>: the static server <title> is never replaced, so `document.title` stays stale.
    const readPageTitle = () => {
        const titles = document.querySelectorAll('title');

        return (titles[titles.length - 1]?.textContent ?? '').split(' - ')[0];
    };

    const [pageTitle, setPageTitle] = useState(readPageTitle);

    useEffect(() => {
        const observer = new MutationObserver(() =>
            setPageTitle(readPageTitle()),
        );
        observer.observe(document.head, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        return () => observer.disconnect();
    }, []);

    const handleClearCache = async () => {
        const ok = await confirm({
            title: 'Xóa toàn bộ cache ảnh?',
            description: `Dung lượng cache hiện tại: ${formatSize(cacheSize)}.`,
            confirmLabel: 'Xóa cache',
            destructive: true,
        });

        if (ok) {
            router.delete('/file-manager/cache', { preserveScroll: true });
        }
    };

    const handleNewFolder = async () => {
        const name = await prompt({
            title: 'Tạo thư mục mới',
            label: 'Tên thư mục',
            confirmLabel: 'Tạo',
        });

        if (name) {
            router.post('/file-manager/folders', { name, parent_id: folderId });
        }
    };

    return (
        <header className="sticky top-0 z-40 flex min-h-(--header-height) shrink-0 items-center gap-2 border-b bg-card transition-[width,height] ease-linear">
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 px-4 py-3 lg:px-6">
                <SidebarTrigger className="-ml-1" />
                <Separator
                    orientation="vertical"
                    className="mx-2 data-[orientation=vertical]:h-4"
                />
                {breadcrumbs ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
                        <Link
                            href="/file-manager"
                            preserveState={false}
                            className="font-medium text-foreground hover:text-foreground/80"
                        >
                            Tất cả tệp
                        </Link>
                        {breadcrumbs.map((crumb) => (
                            <span
                                key={crumb.id}
                                className="flex items-center gap-1"
                            >
                                <ChevronRight className="size-3.5" />
                                <Link
                                    href={`/file-manager?folder=${crumb.id}`}
                                    preserveState={false}
                                    className="hover:text-foreground"
                                >
                                    {crumb.name}
                                </Link>
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="truncate text-sm font-semibold">
                        {pageTitle || ''}
                    </p>
                )}
                <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
                    {isFileManager && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleClearCache}
                                title="Xóa cache ảnh"
                            >
                                <DatabaseZap className="size-4" />
                                Cache: {formatSize(cacheSize)}
                            </Button>
                            <Link href="/file-manager/trash">
                                <Button type="button" variant="outline">
                                    <Trash2 className="size-4" />
                                    Thùng rác
                                </Button>
                            </Link>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleNewFolder}
                            >
                                <FolderPlus className="size-4" />
                                Thư mục mới
                            </Button>
                            <UploadButton folderId={folderId} />
                        </>
                    )}
                    {!isFileManager && headerActions}
                    {!!props.locales?.length && (
                        <select
                            value={locale}
                            onChange={(event) => setLocale(event.target.value)}
                            title="Ngôn ngữ nội dung"
                            className="h-8 rounded-md border bg-background px-2 text-sm"
                        >
                            {props.locales.map((entry) => (
                                <option key={entry.code} value={entry.code}>
                                    {entry.display_name}
                                </option>
                            ))}
                        </select>
                    )}
                </div>
            </div>
        </header>
    );
}
