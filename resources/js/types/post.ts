export type PostStatus =
    | 'draft'
    | 'scheduled'
    | 'publishing'
    | 'published'
    | 'partial'
    | 'failed'
    | 'missed';

export type PostTargetStatus =
    'pending' | 'publishing' | 'published' | 'failed' | 'unknown';

export type PostProviderKey =
    | 'linkedin'
    | 'facebook'
    | 'facebook_personal'
    | 'linkedin_personal'
    | 'instagram';

export type PostAudience = 'self' | 'friends' | 'public' | 'connections';

export type PostAudienceOption = { value: PostAudience; label: string };

export type PostMediaType = 'image' | 'video';

export type PostMedia = { url: string; type: PostMediaType };

export type PostTab = 'all' | 'draft' | 'scheduled' | 'published' | 'failed';

export type PostTargetRow = {
    id: number;
    provider: PostProviderKey;
    label: string;
    group: string | null;
    group_url: string | null;
    letter: string;
    color: string;
    status: PostTargetStatus;
    status_label: string;
    error: string | null;
    external_url: string | null;
    published_at: string | null;
    can_retry: boolean;
};

export type PostRow = {
    id: number;
    title: string | null;
    excerpt: string;
    status: PostStatus;
    status_label: string;
    scheduled_at: string | null;
    published_at: string | null;
    editable: boolean;
    awaiting: boolean;
    cancellable: boolean;
    targets: PostTargetRow[];
};

export type PostProvider = {
    key: PostProviderKey;
    label: string;
    letter: string;
    color: string;
    account: string | null;
    connected: boolean;
    selectable: boolean;
    reason: string | null;
    max_length: number;
    media_types: PostMediaType[];
    requires_media: boolean;
    audiences: PostAudienceOption[];
};

export type PostSocialGroup = {
    id: number;
    provider: PostProviderKey;
    name: string;
    image_url: string | null;
};

export type PostFormValues = {
    id: number;
    title: string | null;
    body: string;
    media: PostMedia[];
    targets: PostProviderKey[];
    audiences: Partial<Record<PostProviderKey, PostAudience>>;
    groups: Partial<Record<PostProviderKey, number[]>>;
    scheduled_date: string | null;
    scheduled_time: string | null;
    status: PostStatus;
};

export type PostPagination = {
    data: PostRow[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
};

export type PostsIndexProps = {
    posts: PostPagination;
    filters: {
        status: PostTab;
        state: PostStatus | null;
        provider: PostProviderKey | null;
        q: string;
    };
    /** * Tab counts: all posts, and posts per platform key. */
    counts: { all: number; providers: Record<string, number> };
    providers: { key: PostProviderKey; label: string }[];
    can: {
        create: boolean;
        update: boolean;
        delete: boolean;
        publish: boolean;
    };
};

export type PostFormProps = {
    post: PostFormValues | null;
    /** * Where the post already went (or is going), for a post that has targets. */
    deliveries: PostTargetRow[];
    providers: PostProvider[];
    socialGroups: PostSocialGroup[];
    timezone: { name: string; label: string };
    maxBodyLength: number;
    canPublish: boolean;
};
