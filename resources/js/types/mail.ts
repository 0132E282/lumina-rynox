import type { IntegrationStatus } from '@/lib/navigation';

export type MailTab = 'inbox' | 'sent';

export type MailPresetKey = 'gmail' | 'outlook' | 'imap';

export type MailPreset = {
    key: MailPresetKey;
    label: string;
    imap: string;
    smtp: string;
    save_sent_copy: boolean;
    warning: string | null;
};

/** * A mailbox as the client sees it: never the password, only whether one is stored. */
export type Mailbox = {
    id: number;
    email: string;
    provider_preset: MailPresetKey;
    imap: string;
    smtp: string;
    sync_interval_minutes: number;
    save_sent_copy: boolean;
    has_password: boolean;
    status: IntegrationStatus;
    status_label: string;
    last_error: string | null;
    last_synced_at: string | null;
};

export type MailboxEdit = Mailbox & { password_mask: string | null };

export type MailboxForm = {
    provider_preset: MailPresetKey;
    email: string;
    password: string;
    imap: string;
    smtp: string;
    sync_interval_minutes: number;
    save_sent_copy: boolean;
};

export type MailConnectionTest = {
    ok: boolean;
    imap_error: string | null;
    smtp_error: string | null;
};

export type MailAccountsIndexProps = {
    mailboxes: Mailbox[];
    legacy_config: boolean;
};

export type MailAccountsFormProps = {
    mailbox: MailboxEdit | null;
    presets: MailPreset[];
    sync_intervals: number[];
};

export type MailboxOption = {
    id: number;
    email: string;
    status: IntegrationStatus;
    status_label: string;
    last_error: string | null;
};

export type MailMessageRow = {
    id: number;
    mailbox_email: string;
    // * Sender in the inbox, first recipient in the Sent tab.
    party_name: string | null;
    party_email: string;
    subject: string | null;
    snippet: string;
    received_at: string | null;
    seen: boolean;
    has_attachments: boolean;
};

export type MailPagination = {
    data: MailMessageRow[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
};

export type MailIndexProps = {
    messages: MailPagination;
    filters: {
        tab: MailTab;
        mailbox: number | null;
        unread: boolean;
        q: string;
    };
    stats: { unread: number; attachments: number };
    mailboxes: MailboxOption[];
    can: { manage_accounts: boolean };
};

export type MailAddress = { name: string | null; email: string };

export type MailAttachment = { name: string; mime: string; size: number };

export type MailMessageDetail = {
    id: number;
    current: boolean;
    role: MailTab;
    from_name: string | null;
    from_email: string | null;
    to: MailAddress[];
    cc: MailAddress[];
    subject: string | null;
    snippet: string;
    received_at: string | null;
    seen: boolean;
    answered: boolean;
    body_loaded: boolean;
    // * Already sanitised on the server; still rendered only inside a sandboxed iframe.
    body_html: string | null;
    body_text: string | null;
    body_truncated: boolean;
    attachments: MailAttachment[];
};

export type MailOutboxStatus = 'sending' | 'sent' | 'unknown' | 'failed';

export type MailOutboxItem = {
    id: number;
    reply_to_message_id: number | null;
    to: string[];
    cc: string[];
    subject: string;
    body_text: string;
    status: MailOutboxStatus;
    error: string | null;
    sent_copy_saved: boolean | null;
    sent_at: string | null;
    created_at: string | null;
};

export type MailShowProps = {
    message: MailMessageDetail;
    thread: MailMessageDetail[];
    outbox: MailOutboxItem[];
    mailbox: { id: number; email: string; save_sent_copy: boolean };
    reply_defaults: { to: string[]; subject: string };
    show_images: boolean;
    can: { send: boolean };
};
