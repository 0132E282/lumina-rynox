import { cn } from '@/lib/utils';

// * Brand letter, colour and name per channel (colours match `config/integrations.php`); unknown providers get a muted initial.
const CHANNELS: Record<
    string,
    { letter: string; color: string; name: string }
> = {
    telegram: { letter: 'T', color: '#229ed9', name: 'Telegram' },
    zalo: { letter: 'Z', color: '#0068ff', name: 'Zalo' },
    messenger: { letter: 'f', color: '#ffffff', name: 'Messenger' },
    email: { letter: '@', color: '#64748b', name: 'Email' },
};

// * Official Facebook logo (blue disc, white "f" running to the bottom edge): Messenger personal chats are Facebook accounts.
export function FacebookLogo() {
    return (
        <svg viewBox="0 0 1024 1024" className="size-full" aria-hidden="true">
            <path
                fill="#1877f2"
                d="M1024 512C1024 229.23 794.77 0 512 0S0 229.23 0 512c0 255.55 187.23 467.37 432 505.78V660H302V512h130V399.2C432 270.88 508.44 200 625.39 200 681.41 200 740 210 740 210v126h-64.56c-63.6 0-83.44 39.47-83.44 80v96h142l-22.7 148H592v357.78C836.77 979.37 1024 767.55 1024 512z"
            />
            <path
                fill="#fff"
                d="M711.3 660 734 512H592v-96c0-40.53 19.84-80 83.44-80H740V210s-58.59-10-114.61-10C508.44 200 432 270.88 432 399.2V512H302v148h130v357.78a517.4 517.4 0 0 0 160 0V660z"
            />
        </svg>
    );
}

/** * Round channel mark for the avatar corner; the channel name is read out through the sr-only text. */
export function ChannelBadge({
    provider,
    className,
}: {
    provider: string;
    className?: string;
}) {
    const channel = CHANNELS[provider];
    const name = channel?.name ?? provider;

    return (
        <span
            className={cn(
                'flex size-4 items-center justify-center rounded-full border-2 border-background text-[9px] font-bold text-white',
                channel ? null : 'bg-muted text-muted-foreground',
                className,
            )}
            style={channel ? { backgroundColor: channel.color } : undefined}
        >
            {provider === 'messenger' ? (
                <FacebookLogo />
            ) : (
                <span aria-hidden="true">
                    {channel?.letter ?? name.charAt(0).toUpperCase()}
                </span>
            )}
            <span className="sr-only">{name}</span>
        </span>
    );
}
