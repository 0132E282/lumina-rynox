export type Admin = {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    profile_url: string | null;
    system_admin: boolean;
    status: 'active' | 'locked';
    email_verified_at: string | null;
    last_seen_at: string | null;
    created_at: string;
    role_names?: string[];
    role_id?: number | null;
};
