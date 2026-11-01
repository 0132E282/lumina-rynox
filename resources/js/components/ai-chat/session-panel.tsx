import { Link } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { show } from '@/actions/App/Http/Controllers/IntegrationController';
import type { ThreadItem } from '@/components/ai-chat/chat-thread';
import { PlatformLogo } from '@/components/posts/platform-logo';
import { computeContextUsage, sumDiffChanges } from '@/lib/chat-session-info';
import type { ContextUsage } from '@/lib/chat-session-info';
import { cn } from '@/lib/utils';
import type { AiChatContext, AiChatIntegration } from '@/types';

const INTEGRATIONS_COLLAPSED = 4;

const PART_STYLE: Record<
    ContextUsage['parts'][number]['key'],
    { label: string; bar: string }
> = {
    user: { label: 'Tin nhắn người dùng', bar: 'bg-chart-1' },
    assistant: { label: 'Trả lời của trợ lý', bar: 'bg-chart-2' },
    system: { label: 'Chỉ dẫn hệ thống', bar: 'bg-chart-3' },
    free: { label: 'Còn trống', bar: 'bg-muted' },
};

const STATUS_DOT: Record<string, string> = {
    connected: 'bg-green-500',
    error: 'bg-destructive',
};

const formatTokens = (tokens: number) =>
    tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0">
            <h3 className="text-xs font-medium text-muted-foreground">
                {title}
            </h3>
            {children}
        </section>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span
                className="min-w-0 truncate text-right font-medium"
                title={value}
            >
                {value}
            </span>
        </div>
    );
}

/** * Read-only side panel of the open chat: estimated context use, diff line totals, environment and integrations. */
export function SessionPanel({
    items,
    chatContext,
    accountLabel,
    repo,
    integrations,
}: {
    items: ThreadItem[];
    chatContext: AiChatContext;
    /** Provider and account name of the AI answering, or null when unknown. */
    accountLabel: string | null;
    repo: string | null;
    integrations: AiChatIntegration[] | null;
}) {
    const [showAll, setShowAll] = useState(false);

    const usage = useMemo(() => {
        const chars = (role: ThreadItem['role']) =>
            items
                .filter((item) => item.role === role)
                .reduce((sum, item) => sum + item.content.length, 0);

        return computeContextUsage({
            userChars: chars('user'),
            assistantChars: chars('assistant'),
            systemChars: chatContext.system_chars,
            windowTokens: chatContext.window_tokens,
        });
    }, [items, chatContext]);

    const changes = useMemo(
        () =>
            sumDiffChanges(
                items
                    .filter((item) => item.role === 'assistant')
                    .map((item) => item.content),
            ),
        [items],
    );

    const usedPercent = Math.round(
        (usage.usedTokens / usage.windowTokens) * 100,
    );
    const visibleIntegrations =
        integrations === null
            ? []
            : showAll
              ? integrations
              : integrations.slice(0, INTEGRATIONS_COLLAPSED);

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-12">
            <Section title="Ngữ cảnh (ước lượng)">
                <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium">{usedPercent}% đã dùng</span>
                    <span className="text-muted-foreground">
                        {formatTokens(usage.usedTokens)} /{' '}
                        {formatTokens(usage.windowTokens)} token
                    </span>
                </div>
                <div
                    role="img"
                    aria-label={`Ước lượng đã dùng ${usedPercent}% cửa sổ ngữ cảnh`}
                    className="flex h-2 overflow-hidden rounded-full bg-muted"
                >
                    {usage.parts
                        .filter((part) => part.key !== 'free')
                        .map((part) => (
                            <div
                                key={part.key}
                                className={PART_STYLE[part.key].bar}
                                style={{ width: `${part.percent}%` }}
                            />
                        ))}
                </div>
                <ul className="flex flex-col gap-1">
                    {usage.parts.map((part) => (
                        <li
                            key={part.key}
                            className="flex items-center gap-2 text-xs"
                        >
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'size-2 shrink-0 rounded-full border',
                                    PART_STYLE[part.key].bar,
                                )}
                            />
                            <span className="flex-1 text-muted-foreground">
                                {PART_STYLE[part.key].label}
                            </span>
                            <span className="tabular-nums">
                                {formatTokens(part.tokens)}
                            </span>
                        </li>
                    ))}
                </ul>
                <p className="text-[0.7rem] text-muted-foreground">
                    Ước lượng theo độ dài ký tự (khoảng 4 ký tự mỗi token),
                    không phải số liệu thật từ nhà cung cấp.
                </p>
            </Section>

            <Section title="Thay đổi">
                {changes.added === 0 && changes.removed === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        Chưa có thay đổi
                    </p>
                ) : (
                    <p className="flex gap-3 text-xs font-medium tabular-nums">
                        <span className="text-green-600 dark:text-green-400">
                            +{changes.added}
                        </span>
                        <span className="text-red-600 dark:text-red-400">
                            −{changes.removed}
                        </span>
                    </p>
                )}
            </Section>

            {(accountLabel !== null || repo !== null) && (
                <Section title="Môi trường">
                    {accountLabel !== null && (
                        <Row label="AI" value={accountLabel} />
                    )}
                    {repo !== null && <Row label="Repo" value={repo} />}
                </Section>
            )}

            {integrations !== null && integrations.length > 0 && (
                <Section title="Kết nối">
                    <ul className="flex flex-col">
                        {visibleIntegrations.map((integration) => (
                            <li key={integration.key}>
                                <Link
                                    href={show.url({
                                        provider: integration.key,
                                    })}
                                    className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                                >
                                    <PlatformLogo
                                        letter={integration.letter}
                                        color={integration.color}
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                        {integration.name}
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            'size-1.5 shrink-0 rounded-full',
                                            STATUS_DOT[integration.status] ??
                                                'bg-muted-foreground/40',
                                        )}
                                    />
                                    <span className="shrink-0 text-muted-foreground">
                                        {integration.status === 'connected'
                                            ? 'Đã kết nối'
                                            : integration.status === 'error'
                                              ? 'Lỗi'
                                              : 'Chưa kết nối'}
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                    {integrations.length > INTEGRATIONS_COLLAPSED && (
                        <button
                            type="button"
                            onClick={() => setShowAll((open) => !open)}
                            className="self-start text-xs text-muted-foreground hover:text-foreground"
                        >
                            {showAll
                                ? 'Thu gọn'
                                : `Xem thêm (${integrations.length - INTEGRATIONS_COLLAPSED})`}
                        </button>
                    )}
                </Section>
            )}
        </div>
    );
}
