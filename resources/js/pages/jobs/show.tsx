import { Head, Link } from '@inertiajs/react';
import {
    ArrowLeft,
    Banknote,
    Check,
    Copy,
    ExternalLink,
    Gift,
    MapPin,
    Send,
    ListChecks,
    Sparkles,
    UserCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { index } from '@/actions/App/Http/Controllers/JobPostingController';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTimePersonal } from '@/lib/personal-date';
import { cn } from '@/lib/utils';
import type { JobApplicationStatus, JobDetail } from '@/types';

const STATUS_LABELS: Record<JobApplicationStatus, string> = {
    new: 'Mới',
    saved: 'Đã lưu',
    skipped: 'Bỏ qua',
    approved: 'Đã duyệt',
    applied: 'Đã nộp',
};

const NOT_STATED = <span className="text-muted-foreground">Tin không nêu</span>;

/** * Round gauge for the 0-100 fit; the ring is green at or above the threshold and neutral below it. */
function ScoreRing({ score, passed }: { score: number; passed: boolean }) {
    const radius = 34;
    const circumference = 2 * Math.PI * radius;

    return (
        <div
            className="relative size-24 shrink-0"
            role="img"
            aria-label={`Độ phù hợp ${score} phần trăm`}
        >
            <svg viewBox="0 0 80 80" className="size-full -rotate-90">
                <circle
                    cx="40"
                    cy="40"
                    r={radius}
                    fill="none"
                    strokeWidth="8"
                    className="stroke-muted"
                />
                <circle
                    cx="40"
                    cy="40"
                    r={radius}
                    fill="none"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - score / 100)}
                    className={passed ? 'stroke-green-600' : 'stroke-slate-400'}
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xl font-semibold">
                {score}%
            </span>
        </div>
    );
}

function Section({
    icon,
    title,
    children,
}: {
    icon: ReactNode;
    title: string;
    children: ReactNode;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <span aria-hidden="true" className="text-muted-foreground">
                        {icon}
                    </span>
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">{children}</CardContent>
        </Card>
    );
}

function CopyEmail({ email }: { email: string }) {
    const [copied, setCopied] = useState(false);

    return (
        <div className="flex flex-wrap items-center gap-2">
            <a
                href={`mailto:${email}`}
                className="font-medium text-blue-600 dark:text-blue-400"
            >
                {email}
            </a>
            <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                    void navigator.clipboard?.writeText(email).then(() => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                    });
                }}
            >
                {copied ? (
                    <Check className="size-4" aria-hidden="true" />
                ) : (
                    <Copy className="size-4" aria-hidden="true" />
                )}
                {copied ? 'Đã chép' : 'Chép email'}
            </Button>
        </div>
    );
}

/** * One bullet per line of the AI's text (a leading dash or bullet is dropped). */
function BulletList({ text }: { text: string }) {
    const items = text
        .split(/\r?\n/)
        .map((item) => item.replace(/^[-•*\s]+/, '').trim())
        .filter(Boolean);

    return (
        <ul className="grid list-disc gap-1 pl-5">
            {items.map((item) => (
                <li key={item}>{item}</li>
            ))}
        </ul>
    );
}

// * Benefits arrive as one short text: split it into bullets on line breaks, `;` and `,` between items.
function splitBenefits(text: string): string[] {
    return text
        .split(/\r?\n|;|,\s+(?=[\p{Lu}\d])/u)
        .map((item) => item.replace(/^[-•*\s]+/, '').trim())
        .filter(Boolean);
}

export default function JobShow({
    job,
    threshold,
}: {
    job: JobDetail;
    threshold: number;
}) {
    const match = job.match;
    const passed = match !== null && match.score >= threshold;
    const benefits = match?.benefits ? splitBenefits(match.benefits) : [];

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
            <Head title={job.title} />
            <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm" variant="outline">
                    <Link href={index.url()}>
                        <ArrowLeft className="size-4" aria-hidden="true" />
                        Việc làm
                    </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                    <a href={job.url} target="_blank" rel="noreferrer noopener">
                        <ExternalLink className="size-4" aria-hidden="true" />
                        Mở tin gốc
                    </a>
                </Button>
            </div>

            <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0 flex-1 basis-72">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{job.source_name}</Badge>
                            <Badge variant="secondary">
                                {STATUS_LABELS[job.application_status]}
                            </Badge>
                        </div>
                        <h1 className="mt-2 text-xl font-semibold">
                            {job.title}
                        </h1>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                            {job.company && <span>{job.company}</span>}
                            {job.location && (
                                <span className="flex items-center gap-1">
                                    <MapPin
                                        className="size-3.5"
                                        aria-hidden="true"
                                    />
                                    {job.location}
                                </span>
                            )}
                            <span>
                                {formatDateTimePersonal(
                                    job.posted_at ?? job.first_seen_at,
                                )}
                                {!job.posted_at && ' (ngày phát hiện)'}
                            </span>
                        </p>
                        {job.tags.length > 0 && (
                            <p className="mt-2 flex flex-wrap gap-1">
                                {job.tags.map((tag) => (
                                    <Badge key={tag} variant="secondary">
                                        {tag}
                                    </Badge>
                                ))}
                            </p>
                        )}
                    </div>
                    {match ? (
                        <div className="flex items-center gap-3">
                            <ScoreRing score={match.score} passed={passed} />
                            <div className="text-sm">
                                <div className="font-medium">
                                    {passed
                                        ? 'Phù hợp với CV'
                                        : 'Chưa phù hợp lắm'}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    Ngưỡng {threshold}%
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
                            Chưa được AI chấm
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
                <Section icon={<Banknote className="size-4" />} title="Lương">
                    <p
                        className={cn(
                            'text-lg font-semibold',
                            !job.salary_text && 'text-muted-foreground',
                        )}
                    >
                        {job.salary_text || 'Tin không nêu'}
                    </p>
                </Section>

                <Section
                    icon={<Gift className="size-4" />}
                    title="Đãi ngộ, phúc lợi"
                >
                    {benefits.length > 0 ? (
                        <ul className="grid list-disc gap-1 pl-5">
                            {benefits.map((benefit) => (
                                <li key={benefit}>{benefit}</li>
                            ))}
                        </ul>
                    ) : (
                        NOT_STATED
                    )}
                </Section>

                <Section
                    icon={<Send className="size-4" />}
                    title="Cách ứng tuyển"
                >
                    <div>
                        <div className="text-xs text-muted-foreground">
                            Email nhận hồ sơ
                        </div>
                        {match?.apply_email ? (
                            <CopyEmail email={match.apply_email} />
                        ) : (
                            NOT_STATED
                        )}
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground">
                            Cách nộp, form cần gửi
                        </div>
                        <p className="whitespace-pre-line">
                            {match?.apply_how || NOT_STATED}
                        </p>
                    </div>
                </Section>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <Section
                    icon={<ListChecks className="size-4" />}
                    title="Mô tả công việc"
                >
                    {match?.description ? (
                        <BulletList text={match.description} />
                    ) : (
                        NOT_STATED
                    )}
                </Section>
                <Section
                    icon={<UserCheck className="size-4" />}
                    title="Yêu cầu ứng viên"
                >
                    {match?.requirements ? (
                        <BulletList text={match.requirements} />
                    ) : (
                        NOT_STATED
                    )}
                </Section>
            </div>

            <Section
                icon={<Sparkles className="size-4" />}
                title="Đánh giá của AI"
            >
                {match ? (
                    <>
                        <p className="whitespace-pre-line">
                            {match.reason || NOT_STATED}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {[
                                match.cv_name && `So với CV "${match.cv_name}"`,
                                match.matched_at &&
                                    `chấm lúc ${formatDateTimePersonal(match.matched_at)}`,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                    </>
                ) : (
                    <p className="text-muted-foreground">
                        Tin này chưa được AI chấm. Việc chấm chạy sau khi tìm
                        việc ở ITviec: bấm &quot;Tìm việc&quot; cạnh CV ở trang
                        CV.
                    </p>
                )}
            </Section>

            {job.note && (
                <Section icon={<Send className="size-4" />} title="Ghi chú">
                    <p className="whitespace-pre-line">{job.note}</p>
                </Section>
            )}
        </div>
    );
}
