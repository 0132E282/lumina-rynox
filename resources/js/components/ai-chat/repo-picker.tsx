import { Link } from '@inertiajs/react';
import { Check, Github, Lock } from 'lucide-react';
import { useState } from 'react';
import { repos as reposRoute } from '@/actions/App/Http/Controllers/AiChatController';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cachedRequest } from '@/lib/ai-chat-cache';
import { requestErrorMessage } from '@/lib/ai-error';
import type { AiChatRepo } from '@/types';

/** * GitHub button under the chat box: pick the repo the AI may read, or go connect GitHub. */
export function RepoPicker({
    repo,
    onChange,
    connected,
    disabled,
    autoPr,
    onAutoPrChange,
}: {
    repo: string | null;
    onChange: (repo: string | null) => void;
    connected: boolean;
    disabled?: boolean;
    /** * Open the pull request for AI edits without a manual approval (never writes to the base branch). */
    autoPr: boolean;
    onAutoPrChange: (value: boolean) => void;
}) {
    const [repos, setRepos] = useState<AiChatRepo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    const load = async () => {
        setError(null);

        try {
            // * Shares the Code tab's cached request (5 minutes).
            setRepos(
                await cachedRequest('github.repos', 5 * 60 * 1000, () =>
                    api
                        .get<{ repos: AiChatRepo[] }>(reposRoute.url())
                        .then(({ data }) => data.repos),
                ),
            );
        } catch (caught) {
            setRepos([]);
            setError(
                requestErrorMessage(caught, 'Không tải được danh sách repo.'),
            );
        }
    };

    const query = search.trim().toLowerCase();
    const shown = (repos ?? []).filter((row) =>
        row.full_name.toLowerCase().includes(query),
    );

    return (
        <DropdownMenu
            onOpenChange={(open) => {
                setSearch('');

                if (open && connected) {
                    void load();
                }
            }}
        >
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    aria-label="Chọn repo GitHub"
                    className="h-8 max-w-44 gap-1.5 px-2 text-muted-foreground"
                >
                    <Github aria-hidden="true" />
                    <span className="truncate">{repo ?? 'GitHub'}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 p-1">
                {!connected ? (
                    <div className="flex flex-col gap-2 p-2">
                        <p className="text-sm text-muted-foreground">
                            Kết nối GitHub (token chỉ đọc) để AI đọc repo khi
                            review code.
                        </p>
                        <Button asChild size="sm">
                            <Link href="/integrations/github">
                                Kết nối GitHub
                            </Link>
                        </Button>
                    </div>
                ) : (
                    <>
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            onKeyDown={(event) => event.stopPropagation()}
                            aria-label="Tìm repo"
                            placeholder="Tìm repo..."
                            className="mb-1 h-8 shadow-none"
                        />
                        <div className="max-h-64 overflow-y-auto">
                            {repos === null && (
                                <p className="px-2 py-3 text-sm text-muted-foreground">
                                    Đang tải...
                                </p>
                            )}
                            {error && (
                                <p className="px-2 py-3 text-sm text-destructive">
                                    {error}
                                </p>
                            )}
                            {repos !== null && !error && shown.length === 0 && (
                                <p className="px-2 py-3 text-sm text-muted-foreground">
                                    Không có repo phù hợp.
                                </p>
                            )}
                            {shown.map((row) => (
                                <DropdownMenuItem
                                    key={row.full_name}
                                    onSelect={() => onChange(row.full_name)}
                                    className="justify-between gap-2"
                                >
                                    <span className="flex min-w-0 items-center gap-1.5">
                                        <span className="truncate">
                                            {row.full_name}
                                        </span>
                                        {row.private && (
                                            <Lock
                                                aria-label="Repo riêng tư"
                                                className="size-3 shrink-0 text-muted-foreground"
                                            />
                                        )}
                                    </span>
                                    {row.full_name === repo && (
                                        <Check aria-hidden="true" />
                                    )}
                                </DropdownMenuItem>
                            ))}
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem
                            checked={autoPr}
                            onCheckedChange={onAutoPrChange}
                            onSelect={(event) => event.preventDefault()}
                        >
                            Tự tạo Pull Request khi AI sửa code
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        {repo && (
                            <DropdownMenuItem onSelect={() => onChange(null)}>
                                Bỏ chọn repo
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem asChild>
                            <Link href="/integrations/github">
                                Quản lý kết nối GitHub
                            </Link>
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
