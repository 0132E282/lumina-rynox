export type JobSourceKey =
    'topcv' | 'itviec' | 'careerviet' | 'glints' | 'vietnamworks' | 'topdev';

export type JobApplicationStatus =
    'new' | 'saved' | 'skipped' | 'approved' | 'applied';

export type JobSource = {
    key: JobSourceKey;
    name: string;
    letter: string;
    color: string;
    active: boolean;
    // * Read by crawling public pages / from job-alert e-mails (a source can be both).
    crawl: boolean;
    // * Whether the crawl switch is on (only meaningful when `crawl`).
    enabled: boolean;
    email: boolean;
    last_status: string | null;
    last_message: string | null;
    last_at: string | null;
    email_last_status: string | null;
    email_last_count: number | null;
    email_last_at: string | null;
};

export type JobRow = {
    id: number;
    source: JobSourceKey;
    title: string;
    company: string | null;
    location: string | null;
    salary_text: string | null;
    tags: string[];
    url: string;
    via: 'email' | null;
    posted_at: string | null;
    first_seen_at: string;
    application_status: JobApplicationStatus;
    applied_at: string | null;
    note: string | null;
    // * The AI's fit with the CV (0-100); null when the job was never scored.
    match_score: number | null;
};

export type JobMatch = {
    score: number;
    reason: string | null;
    benefits: string | null;
    description: string | null;
    requirements: string | null;
    apply_email: string | null;
    apply_how: string | null;
    cv_name: string | null;
    matched_at: string | null;
};

export type JobDetail = Omit<JobRow, 'via' | 'match_score'> & {
    source_name: string;
    match: JobMatch | null;
};

export type JobPagination = {
    data: JobRow[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
};

export type JobsIndexProps = {
    jobs: JobPagination;
    filters: {
        source: JobSourceKey | null;
        q: string;
        status: JobApplicationStatus | null;
    };
    sources: JobSource[];
    summary: {
        total: number;
        new_24h: number;
        by_source: Record<JobSourceKey, number>;
    };
    can: { update: boolean };
};
