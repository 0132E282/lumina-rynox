import { Search, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import InputError from '@/components/input-error';
import { PlatformLogo } from '@/components/social/platform-logo';
import { PlatformTabs } from '@/components/social/platform-tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { useInitials } from '@/hooks/use-initials';
import type { PostProvider, PostProviderKey, PostSocialGroup } from '@/types';

const ALL = 'all';

type GroupPickerProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** * Platforms that can post to groups; each becomes a tab. */
    providers: PostProvider[];
    groups: PostSocialGroup[];
    selected: Partial<Record<PostProviderKey, number[]>>;
    onToggle: (provider: PostProviderKey, id: number, checked: boolean) => void;
    errorOf: (key: string) => string | undefined;
};

// * Search ignores case and Vietnamese accents.
const fold = (text: string) =>
    text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

/** * Summary of the chosen groups on the form; the long list lives in a popup (platform tabs with counts, search, tick list). */
export function GroupPicker({
    open,
    onOpenChange,
    providers,
    groups: allGroups,
    selected,
    onToggle,
    errorOf,
}: GroupPickerProps) {
    const getInitials = useInitials();
    // * Only platforms switched to "Nhóm" on the form are offered.
    const groups = useMemo(
        () =>
            allGroups.filter((group) =>
                providers.some((provider) => provider.key === group.provider),
            ),
        [allGroups, providers],
    );
    const [chosenTab, setTab] = useState<string>(ALL);
    // * A tab whose platform was switched off falls back to "Tất cả".
    const tab = providers.some((provider) => provider.key === chosenTab)
        ? chosenTab
        : ALL;
    const [query, setQuery] = useState('');
    const needle = fold(query.trim());

    const counts = useMemo(() => {
        const result: Record<string, number> = { [ALL]: groups.length };

        for (const group of groups) {
            result[group.provider] = (result[group.provider] ?? 0) + 1;
        }

        return result;
    }, [groups]);

    const isPicked = (group: PostSocialGroup) =>
        (selected[group.provider] ?? []).includes(group.id);
    const picked = groups.filter(isPicked);
    const visible = groups.filter(
        (group) =>
            (tab === ALL || group.provider === tab) &&
            (needle === '' || fold(group.name).includes(needle)),
    );
    const providerOf = (key: PostProviderKey) =>
        providers.find((provider) => provider.key === key);

    return (
        <div className="grid gap-2 rounded-md bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-sm font-medium">Đăng vào nhóm đã lưu</p>
                    {picked.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                            Chưa chọn nhóm nào.
                        </p>
                    )}
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenChange(true)}
                >
                    <Users aria-hidden="true" className="size-4" />
                    Chọn nhóm
                </Button>
            </div>
            {picked.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                    {picked.map((group) => (
                        <li
                            key={group.id}
                            className="flex max-w-full items-center gap-2 rounded-md border bg-muted/40 py-1 pr-1 pl-1.5"
                        >
                            <Avatar className="size-6 rounded-md">
                                <AvatarImage
                                    src={group.image_url ?? undefined}
                                    alt=""
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                />
                                <AvatarFallback
                                    aria-hidden="true"
                                    className="rounded-md text-[10px]"
                                >
                                    {getInitials(group.name)}
                                </AvatarFallback>
                            </Avatar>
                            <span className="truncate text-sm">
                                {group.name}
                            </span>
                            <button
                                type="button"
                                aria-label={`Bỏ chọn ${group.name}`}
                                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                onClick={() =>
                                    onToggle(group.provider, group.id, false)
                                }
                            >
                                <X aria-hidden="true" className="size-3.5" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {providers.map((provider) => (
                <InputError
                    key={provider.key}
                    message={errorOf(`groups.${provider.key}`)}
                />
            ))}

            <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
                <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-xl">
                    <DrawerHeader>
                        <DrawerTitle>Chọn nhóm để đăng</DrawerTitle>
                        <DrawerDescription>
                            Các nhóm được đăng lần lượt, cách nhau vài phút và
                            theo giới hạn số bài mỗi giờ.
                        </DrawerDescription>
                    </DrawerHeader>
                    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4">
                        {providers.length > 1 && (
                            <PlatformTabs
                                ariaLabel="Lọc nhóm theo nền tảng"
                                value={tab === ALL ? null : tab}
                                onChange={(next) => setTab(next ?? ALL)}
                                allCount={counts[ALL]}
                                items={providers.map((provider) => ({
                                    key: provider.key,
                                    label: provider.label,
                                    count: counts[provider.key] ?? 0,
                                    letter: provider.letter,
                                    color: provider.color,
                                }))}
                            />
                        )}
                        <div className="relative">
                            <Search
                                aria-hidden="true"
                                className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
                            />
                            <Input
                                value={query}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                                placeholder="Tìm nhóm"
                                aria-label="Tìm nhóm"
                                className="h-9 pl-8"
                            />
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {visible.length === 0 && (
                                <p className="py-6 text-center text-sm text-muted-foreground">
                                    Không có nhóm nào.
                                </p>
                            )}
                            {visible.map((group) => {
                                const id = `post-group-${group.id}`;
                                const provider = providerOf(group.provider);

                                return (
                                    <div
                                        key={group.id}
                                        className="flex items-center gap-2 rounded px-1 py-1.5 hover:bg-accent/50"
                                    >
                                        <Checkbox
                                            id={id}
                                            checked={isPicked(group)}
                                            onCheckedChange={(value) =>
                                                onToggle(
                                                    group.provider,
                                                    group.id,
                                                    value === true,
                                                )
                                            }
                                        />
                                        <label
                                            htmlFor={id}
                                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm"
                                        >
                                            <Avatar className="size-7 rounded-md">
                                                <AvatarImage
                                                    src={
                                                        group.image_url ??
                                                        undefined
                                                    }
                                                    alt=""
                                                    loading="lazy"
                                                    referrerPolicy="no-referrer"
                                                />
                                                <AvatarFallback
                                                    aria-hidden="true"
                                                    className="rounded-md text-xs"
                                                >
                                                    {getInitials(group.name)}
                                                </AvatarFallback>
                                            </Avatar>
                                            {tab === ALL && provider && (
                                                <PlatformLogo
                                                    provider={provider.key}
                                                    letter={provider.letter}
                                                    color={provider.color}
                                                    className="size-4"
                                                />
                                            )}
                                            <span className="truncate">
                                                {group.name}
                                            </span>
                                        </label>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <DrawerFooter className="flex-row items-center justify-between border-t">
                        <span className="text-sm text-muted-foreground">
                            Đã chọn {picked.length} nhóm
                        </span>
                        <DrawerClose asChild>
                            <Button type="button">Xong</Button>
                        </DrawerClose>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>
        </div>
    );
}
