import { Search, Smile } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** * `emoji|keywords` (Vietnamese, lowercase, no accents needed: search strips them). */
type Group = { key: string; label: string; icon: string; items: string[] };

const GROUPS: Group[] = [
    {
        key: 'smileys',
        label: 'Mặt cười',
        icon: '😀',
        items: [
            '😀|cuoi vui',
            '😃|cuoi vui',
            '😄|cuoi vui',
            '😁|cuoi toe',
            '😆|cuoi',
            '😅|cuoi do mo hoi',
            '😂|cuoi ra nuoc mat',
            '🤣|cuoi lan',
            '🙂|cuoi nhe',
            '😉|nhay mat',
            '😊|cuoi e then',
            '😇|thien than',
            '🥰|yeu thuong',
            '😍|yeu mat tim',
            '🤩|sao mat',
            '😘|hon',
            '😋|ngon',
            '😛|le luoi',
            '😜|le luoi nhay mat',
            '🤪|dien',
            '🤗|om',
            '🤔|suy nghi',
            '🤐|im lang',
            '😐|tro',
            '😏|nhech mep',
            '😴|ngu',
            '😌|nhe nhom',
            '😎|ngau kinh ram',
            '🤓|mot sach',
            '😢|khoc buon',
            '😭|khoc lon',
            '😤|tuc gian',
            '😡|gian du',
            '🥺|nai',
            '😱|so hai',
            '😳|ngai do mat',
            '🙄|dao mat',
            '😬|nhan mat',
            '🥵|nong',
            '🥶|lanh',
            '🤮|oi',
            '😷|khau trang om',
            '🤒|sot',
            '🤯|no dau',
            '🥳|an mung tiec',
            '😈|quy',
            '💀|dau lau',
            '🤡|hoe',
        ],
    },
    {
        key: 'gestures',
        label: 'Cử chỉ',
        icon: '👍',
        items: [
            '👍|like thich tot',
            '👎|dislike khong thich',
            '👌|ok',
            '✌️|hoa binh chien thang',
            '🤞|cau may',
            '🤟|yeu',
            '🤘|rock',
            '👏|vo tay',
            '🙌|gio tay',
            '🙏|cam on cau xin',
            '💪|manh me',
            '👋|chao tam biet',
            '🤝|bat tay',
            '☝️|mot chi len',
            '👉|chi phai',
            '👈|chi trai',
            '👆|chi len',
            '👇|chi xuong',
            '✋|dung',
            '🤙|goi dien',
            '🫶|trai tim tay',
            '🙈|che mat',
            '🙉|bit tai',
            '🙊|bit mieng',
        ],
    },
    {
        key: 'hearts',
        label: 'Trái tim',
        icon: '❤️',
        items: [
            '❤️|tim yeu do',
            '🧡|tim cam',
            '💛|tim vang',
            '💚|tim xanh la',
            '💙|tim xanh duong',
            '💜|tim tim',
            '🖤|tim den',
            '🤍|tim trang',
            '💔|tim vo',
            '💕|hai tim',
            '💞|tim xoay',
            '💖|tim lap lanh',
            '💘|tim mui ten',
            '💝|tim qua',
            '❣️|than tim',
            '💋|hon moi',
        ],
    },
    {
        key: 'nature',
        label: 'Thiên nhiên & động vật',
        icon: '🐶',
        items: [
            '🐶|cho',
            '🐱|meo',
            '🐭|chuot',
            '🐰|tho',
            '🦊|cao',
            '🐻|gau',
            '🐼|gau truc',
            '🐯|ho',
            '🦁|su tu',
            '🐮|bo',
            '🐷|heo lon',
            '🐸|ech',
            '🐵|khi',
            '🐔|ga',
            '🐧|chim canh cut',
            '🦄|ky lan',
            '🐝|ong',
            '🦋|buom',
            '🌸|hoa anh dao',
            '🌹|hoa hong',
            '🌻|huong duong',
            '🌳|cay',
            '🌞|mat troi',
            '🌙|mat trang',
            '⭐|ngoi sao',
            '🌈|cau vong',
            '☔|mua',
            '❄️|tuyet',
        ],
    },
    {
        key: 'food',
        label: 'Đồ ăn & thức uống',
        icon: '🍜',
        items: [
            '🍎|tao',
            '🍌|chuoi',
            '🍉|dua hau',
            '🍓|dau tay',
            '🍑|dao',
            '🥭|xoai',
            '🍕|pizza',
            '🍔|hamburger',
            '🍟|khoai tay chien',
            '🍜|mi pho',
            '🍚|com',
            '🍣|sushi',
            '🍰|banh kem',
            '🍩|donut',
            '🍪|banh quy',
            '🍫|socola',
            '🍦|kem',
            '☕|ca phe',
            '🍵|tra',
            '🍺|bia',
            '🍻|cung ly',
            '🥂|nang ly',
            '🧋|tra sua',
        ],
    },
    {
        key: 'activity',
        label: 'Hoạt động & đồ vật',
        icon: '🎉',
        items: [
            '🎉|chuc mung tiec',
            '🎊|phao giay',
            '🎁|qua tang',
            '🎂|sinh nhat',
            '🎈|bong bay',
            '⚽|bong da',
            '🏀|bong ro',
            '🎮|game',
            '🎧|tai nghe',
            '🎵|nhac',
            '📷|may anh',
            '💻|laptop may tinh',
            '📱|dien thoai',
            '💡|y tuong den',
            '🔥|lua hot',
            '✨|lap lanh',
            '💯|100 diem',
            '💬|tin nhan',
            '📎|ghim dinh kem',
            '📞|goi dien',
            '⏰|bao thuc gio',
            '🚗|xe hoi',
            '🏠|nha',
            '✈️|may bay',
        ],
    },
    {
        key: 'symbols',
        label: 'Biểu tượng',
        icon: '✅',
        items: [
            '✅|dung xong',
            '❌|sai huy',
            '❓|hoi',
            '❗|chu y',
            '⚠️|canh bao',
            '⭕|vong tron',
            '➕|them',
            '➖|bot',
            '🔔|chuong thong bao',
            '🔒|khoa',
            '🔑|chia khoa',
            '💲|tien do la',
            '🆗|ok',
            '🆕|moi',
            '🔴|do',
            '🟢|xanh',
            '🔵|xanh duong',
            '🟡|vang',
        ],
    },
];

// * Search ignores case and Vietnamese accents, so "cuoi" finds the laughing faces.
const fold = (text: string) =>
    text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

type EmojiPickerProps = {
    disabled: boolean;
    onPick: (emoji: string) => void;
};

/** * Built-in set (no extra dependency): search box, grouped grid and a bottom bar that jumps between groups. The parent inserts the pick at the caret. */
export function EmojiPicker({ disabled, onPick }: EmojiPickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(GROUPS[0].key);
    const scroller = useRef<HTMLDivElement>(null);
    const needle = fold(query.trim());

    const groups = useMemo(
        () =>
            GROUPS.map((group) => ({
                ...group,
                items: group.items
                    .map((item) => {
                        const [emoji, words] = item.split('|');

                        return { emoji, words };
                    })
                    .filter(
                        (item) =>
                            needle === '' ||
                            item.words.includes(needle) ||
                            fold(group.label).includes(needle),
                    ),
            })).filter((group) => group.items.length > 0),
        [needle],
    );

    const jump = (key: string) => {
        setActive(key);
        scroller.current
            ?.querySelector(`[data-group="${key}"]`)
            ?.scrollIntoView({ block: 'start' });
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                setQuery('');
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label="Chèn emoji"
                >
                    <Smile aria-hidden="true" className="size-5" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                side="top"
                className="flex h-96 w-80 flex-col gap-2 p-0"
            >
                <div className="border-b px-3 pt-3 pb-2">
                    <div className="mb-2 text-center text-xs font-semibold tracking-wide text-primary">
                        EMOJI
                    </div>
                    <div className="relative">
                        <Search
                            aria-hidden="true"
                            className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Tìm kiếm emoji"
                            aria-label="Tìm kiếm emoji"
                            className="h-8 pl-8"
                        />
                    </div>
                </div>
                <div
                    ref={scroller}
                    className="min-h-0 flex-1 overflow-y-auto px-3 pb-2"
                >
                    {groups.length === 0 && (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            Không tìm thấy emoji.
                        </p>
                    )}
                    {groups.map((group) => (
                        <section key={group.key} data-group={group.key}>
                            <h3 className="py-1 text-xs font-medium text-muted-foreground">
                                {group.label}
                            </h3>
                            <div className="grid grid-cols-7 gap-0.5">
                                {group.items.map(({ emoji }) => (
                                    <button
                                        key={emoji}
                                        type="button"
                                        className="rounded p-1 text-2xl leading-none hover:bg-accent"
                                        onClick={() => {
                                            onPick(emoji);
                                            setOpen(false);
                                        }}
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
                <div className="flex items-center justify-between border-t px-2 py-1">
                    {GROUPS.map((group) => (
                        <button
                            key={group.key}
                            type="button"
                            aria-label={group.label}
                            title={group.label}
                            disabled={needle !== ''}
                            className={cn(
                                'rounded p-1 text-lg leading-none hover:bg-accent disabled:opacity-40',
                                active === group.key && 'bg-accent',
                            )}
                            onClick={() => jump(group.key)}
                        >
                            {group.icon}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
