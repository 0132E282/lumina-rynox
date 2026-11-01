import { AlertTriangle } from 'lucide-react';
import { PlatformLogo } from '@/components/social/platform-logo';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PostMedia, PostProvider } from '@/types';

type PostPreviewProps = {
    providers: PostProvider[];
    body: string;
    media: PostMedia[];
    /** * Display text such as `28/10/2026 09:00`, or null when no time is set. */
    when: string | null;
};

type ProviderPreviewProps = Omit<PostPreviewProps, 'providers'> & {
    provider: PostProvider;
};

/** * One card holding a section per platform, each with that platform's character limit; warnings mirror the checks the server enforces on save. */
export function PostPreview({
    providers,
    body,
    media,
    when,
}: PostPreviewProps) {
    return (
        <Card>
            <CardHeader className="border-b">
                <CardTitle>Xem trước</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 divide-y *:pt-4 first:*:pt-0">
                {providers.map((provider) => (
                    <ProviderPreview
                        key={provider.key}
                        provider={provider}
                        body={body}
                        media={media}
                        when={when}
                    />
                ))}
            </CardContent>
        </Card>
    );
}

function ProviderPreview({
    provider,
    body,
    media,
    when,
}: ProviderPreviewProps) {
    const length = body.length;
    const warnings: string[] = [];

    if (length > provider.max_length) {
        warnings.push(
            `Vượt giới hạn ${provider.max_length} ký tự của ${provider.label} (${length}).`,
        );
    }

    if (provider.requires_media && media.length === 0) {
        warnings.push(`${provider.label} yêu cầu ít nhất một ảnh hoặc video.`);
    }

    if (media.some((item) => !provider.media_types.includes(item.type))) {
        warnings.push(`${provider.label} chưa hỗ trợ một số tệp đính kèm.`);
    }

    const image = media.find((item) => item.type === 'image');

    return (
        <section
            aria-label={`Xem trước ${provider.label}`}
            className="grid gap-2 text-sm"
        >
            <div className="flex items-center gap-2">
                <PlatformLogo
                    provider={provider.key}
                    letter={provider.letter}
                    color={provider.color}
                />
                <div className="min-w-0">
                    <div className="truncate font-medium">
                        {provider.account ?? provider.label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {when ? `Lên lịch ${when}` : 'Chưa đặt giờ'}
                    </div>
                </div>
            </div>
            {image && (
                <img
                    src={image.url}
                    alt=""
                    className="max-h-48 w-full rounded object-cover"
                />
            )}
            {media.length > 1 && (
                <span className="text-xs text-muted-foreground">
                    {media.length} tệp đính kèm
                </span>
            )}
            {warnings.map((warning) => (
                <p
                    key={warning}
                    role="alert"
                    className="flex items-start gap-2 text-xs text-destructive"
                >
                    <AlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 size-3.5 shrink-0"
                    />
                    {warning}
                </p>
            ))}
        </section>
    );
}
