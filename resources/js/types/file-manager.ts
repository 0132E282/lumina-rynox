export type FileItem = {
    id: number;
    parent_id: number | null;
    type: 'file' | 'folder';
    name: string;
    original_name: string | null;
    url: string | null;
    mime_type: string | null;
    extension: string | null;
    size: number;
    alt: string | null;
    created_at: string;
    shared?: boolean | null;
    can_manage_permissions?: boolean;
};

export type Breadcrumb = { id: number; name: string };

export type TreeFolder = { id: number; name: string; parent_id: number | null };

export type Paginated<T> = {
    data: T[];
    links: { url: string | null; label: string; active: boolean }[];
    current_page: number;
    last_page: number;
};
