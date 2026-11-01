import { FacebookLogo } from '@/components/chat/channel-badge';
import { cn } from '@/lib/utils';

// * Official LinkedIn "in" mark (24x24, brand blue); the Facebook logo is shared with the chat channel badge.
function LinkedInLogo() {
    return (
        <svg viewBox="0 0 24 24" className="size-full" aria-hidden="true">
            <path
                fill="#0a66c2"
                d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
            />
        </svg>
    );
}

// * Instagram glyph (24x24) on its brand gradient.
function InstagramLogo() {
    return (
        <svg viewBox="0 0 24 24" className="size-full" aria-hidden="true">
            <defs>
                <linearGradient id="ig-gradient" x1="0" y1="1" x2="1" y2="0">
                    <stop offset="0" stopColor="#feda75" />
                    <stop offset="0.35" stopColor="#fa7e1e" />
                    <stop offset="0.6" stopColor="#d62976" />
                    <stop offset="1" stopColor="#4f5bd5" />
                </linearGradient>
            </defs>
            <rect width="24" height="24" rx="6" fill="url(#ig-gradient)" />
            <rect
                x="5"
                y="5"
                width="14"
                height="14"
                rx="4"
                fill="none"
                stroke="#fff"
                strokeWidth="1.8"
            />
            <circle
                cx="12"
                cy="12"
                r="3.2"
                fill="none"
                stroke="#fff"
                strokeWidth="1.8"
            />
            <circle cx="16.4" cy="7.6" r="1.1" fill="#fff" />
        </svg>
    );
}

/** * Brand logo of a posting platform; an unknown platform falls back to its coloured initial. */
export function PlatformLogo({
    provider,
    letter,
    color,
    className,
}: {
    provider: string;
    letter: string;
    color: string;
    className?: string;
}) {
    if (provider.startsWith('facebook')) {
        return (
            <span className={cn('size-6 shrink-0', className)}>
                <FacebookLogo />
            </span>
        );
    }

    if (provider.startsWith('linkedin')) {
        return (
            <span className={cn('size-6 shrink-0', className)}>
                <LinkedInLogo />
            </span>
        );
    }

    if (provider.startsWith('instagram')) {
        return (
            <span className={cn('size-6 shrink-0', className)}>
                <InstagramLogo />
            </span>
        );
    }

    return (
        <span
            aria-hidden="true"
            className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded text-xs font-semibold text-white',
                className,
            )}
            style={{ backgroundColor: color }}
        >
            {letter}
        </span>
    );
}
