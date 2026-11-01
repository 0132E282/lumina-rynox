import { PlatformLogo } from '@/components/social/platform-logo';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const ALL = 'all';

export type PlatformTabItem = {
    key: string;
    label: string;
    count: number;
    /** * Fallback initial and colour for a platform without a brand logo. */
    letter: string;
    color: string;
};

type PlatformTabsProps = {
    /** * Selected platform key, or null for "Tất cả". */
    value: string | null;
    onChange: (value: string | null) => void;
    items: PlatformTabItem[];
    allCount: number;
    ariaLabel?: string;
};

/** * Line tabs "Tất cả (n)" + one tab per platform with its brand logo and count. Shared by the posts list, the groups page and the group picker. */
export function PlatformTabs({
    value,
    onChange,
    items,
    allCount,
    ariaLabel = 'Lọc theo nền tảng',
}: PlatformTabsProps) {
    return (
        <Tabs
            value={value ?? ALL}
            onValueChange={(next) => onChange(next === ALL ? null : next)}
        >
            <TabsList
                variant="line"
                aria-label={ariaLabel}
                className="w-full justify-start overflow-x-auto"
            >
                <TabsTrigger value={ALL} className="flex-none px-3">
                    Tất cả ({allCount})
                </TabsTrigger>
                {items.map((item) => (
                    <TabsTrigger
                        key={item.key}
                        value={item.key}
                        className="flex-none gap-2 px-3"
                    >
                        <PlatformLogo
                            provider={item.key}
                            letter={item.letter}
                            color={item.color}
                            className="size-4"
                        />
                        {item.label.replace(/\s*\(không chính thức\)$/, '')} (
                        {item.count})
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    );
}
