import { router } from '@inertiajs/react';
import { Button } from '@/components/ui/button';
import type { Paginated } from '@/types';
import { paginationLabel } from './format';

export function FileManagerPagination<T>({ files }: { files: Paginated<T> }) {
    if (files.last_page <= 1) {
        return null;
    }

    return (
        <div className="flex flex-wrap items-center gap-1">
            {files.links.map((link, index) => (
                <Button
                    key={index}
                    type="button"
                    variant={link.active ? 'default' : 'outline'}
                    size="sm"
                    disabled={!link.url}
                    onClick={() =>
                        link.url &&
                        router.get(
                            link.url,
                            {},
                            {
                                preserveState: true,
                                preserveScroll: true,
                                only: ['files'],
                            },
                        )
                    }
                >
                    <span>{paginationLabel(link.label)}</span>
                </Button>
            ))}
        </div>
    );
}
