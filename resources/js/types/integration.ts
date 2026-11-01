import type { IntegrationStatus } from '@/lib/navigation';

export type { IntegrationStatus };

export type IntegrationFieldType = 'text' | 'secret' | 'select';

export type IntegrationField = {
    key: string;
    label: string;
    type: IntegrationFieldType;
    required: boolean;
    hint: string | null;
    placeholder: string | null;
    unofficial: boolean;
    options: { value: string; label: string }[];
    // * Null for secrets: they never reach the client, only `mask` (last 4 characters) does.
    value: string | null;
    mask: string | null;
};

export type IntegrationPermission = {
    key: string;
    label: string;
    description: string;
    unofficial: boolean;
    checked: boolean;
};

export type IntegrationOAuth = {
    configured: boolean;
    connected_via: string | null;
    expires_at: string | null;
    // * `expiring` = under 7 days left; null when no expiry is known (manual token).
    expiry: 'ok' | 'expiring' | 'expired' | null;
};

/** * One signed-in account of a chat channel (Messenger, Zalo), as listed on the channel's own page. */
export type IntegrationAccountSummary = {
    id: number;
    name: string | null;
    avatar_url: string | null;
    status: IntegrationStatus;
    last_error: string | null;
    /** * ISO 8601. */
    connected_at: string | null;
    /** * ISO 8601: when the bridge state of this account was last read. */
    last_checked_at: string | null;
    /** * Scopes ticked for this account (`receive`, `reply`, `proactive`). */
    permissions: string[];
    /** * Zalo only: `mention_only`, `all` or `off`. */
    group_mode?: string;
};

/** * Messenger and Zalo accounts share the generic account shape. */
export type MessengerAccountSummary = IntegrationAccountSummary;

export type MessengerAccountPermission = {
    key: string;
    label: string;
    description: string;
    default: boolean;
};

/** * One AI account on the AI integration page. The token never reaches the client: only its 4-character mask. */
export type AiAccountSummary = {
    id: number;
    name: string;
    vendor: string;
    auth_type: 'api_token' | 'session_token';
    model: string | null;
    enabled: boolean;
    status: IntegrationStatus;
    last_error: string | null;
    /** * ISO 8601. */
    last_checked_at: string | null;
    purposes: string[];
    priority: number;
    token_mask: string | null;
};

export type AiOptions = {
    vendors: { value: string; label: string }[];
    auth_types: { value: string; label: string }[];
    purposes: { value: string; label: string }[];
};

export type IntegrationPage = {
    key: string;
    name: string;
    letter: string;
    color: string;
    description: string;
    save_label: string;
    unofficial: boolean;
    unofficial_warning: string;
    risk_acknowledged: boolean;
    can_test: boolean;
    // * `qr`: scan a QR code (Zalo); `oauth`: sign in on the provider's site (LinkedIn); `matrix_bridge`: paste a
    // * facebook.com cookie, sent once to the Messenger bridge's Provisioning API (Messenger).
    login: 'qr' | 'oauth' | 'matrix_bridge' | null;
    account_name: string | null;
    /** * Signed-in Messenger accounts (empty for other providers). */
    accounts: MessengerAccountSummary[];
    /** * Scopes offered per Messenger account (empty for other providers). */
    account_permissions: MessengerAccountPermission[];
    /** * Zalo only: group answer modes an account can pick (empty for other providers). */
    account_group_modes: { value: string; label: string }[];
    oauth: IntegrationOAuth | null;
    /** * AI provider only: its accounts and dialog choices (empty/null for other providers). */
    ai_accounts: AiAccountSummary[];
    ai_options: AiOptions | null;
    active: boolean;
    fields: IntegrationField[];
    permissions: IntegrationPermission[];
    steps: string[];
    security_notes: string[];
    status: IntegrationStatus;
    status_label: string;
    last_checked_at: string | null;
    last_error: string | null;
};

export type IntegrationCard = {
    key: string;
    name: string;
    letter: string;
    color: string;
    description: string;
    active: boolean;
    status: IntegrationStatus;
    status_label: string;
    /** * Multi-account channels only (Zalo, Messenger); null otherwise. */
    accounts: { connected: number; total: number } | null;
};

export type IntegrationGroup = {
    key: string;
    title: string;
    providers: IntegrationCard[];
};

export type ZaloContactSyncResult = {
    friends: number;
    groups: number;
    created: number;
    updated: number;
    truncated: boolean;
};

export type ZaloQrState =
    'waiting' | 'scanned' | 'expired' | 'declined' | 'logged_in' | 'error';

export type ZaloQrStatus = {
    state: ZaloQrState;
    image: string | null;
    error_code: string | null;
};

export type SocialGroupSummary = {
    id: number;
    name: string;
    url: string;
    image_url: string | null;
    synced_at: string;
    left_at: string | null;
};
