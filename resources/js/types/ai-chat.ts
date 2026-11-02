import type { AiAccountLimit } from './integration';

export type AiChatRole = 'user' | 'assistant';

export type AiChatConversation = {
    /** * Public uuid (used in the URL and the API). */
    id: string;
    title: string;
    /** * `owner/name` of the GitHub repo this chat belongs to, or null. */
    repo: string | null;
    /** * ISO 8601. */
    updated_at: string;
};

/** * A file edit the AI proposed for a GitHub repo; nothing is written until the person approves it. */
export type AiChatProposal = {
    id: number;
    repo: string;
    path: string;
    action: 'create' | 'update';
    diff: string | null;
    /** * The proposed full text of the file. */
    content: string;
    status: 'pending' | 'applied' | 'rejected' | 'reverted';
    pull_url: string | null;
};

export type AiChatMessage = {
    id: number;
    role: AiChatRole;
    content: string;
    /** * ISO 8601. */
    created_at: string;
    proposals?: AiChatProposal[];
};

export type AiChatAccount = {
    id: number;
    name: string;
    /** * `anthropic|openai|google|deepseek`. */
    vendor_key: string;
    vendor: string;
    model: string | null;
    /** * Models the picker offers for this account. */
    models: { id: string; label: string }[];
    /** * Reply length cap for API accounts; null for CLI accounts (their own limits apply). */
    max_output_tokens: number | null;
    /** * `connected|error|disconnected`. */
    status: string;
};

/** * Answer mode: "auto" replies normally, "plan" asks for a step-by-step plan only. */
export type AiChatMode = 'auto' | 'plan';

/** * The AI account and model that answer the next message. `model` null = the account's own model. */
export type AiChatSelection = {
    accountId: number | null;
    model: string | null;
};

export type AiChatRepo = {
    full_name: string;
    private: boolean;
    default_branch: string;
    description: string | null;
};

export type AiChatPageProps = {
    /** * The latest conversations of the signed-in admin only. */
    conversations: AiChatConversation[];
    activeConversation: AiChatConversation | null;
    messages: AiChatMessage[];
    /** * Enabled AI accounts that answer chat, in the order they are tried. */
    aiAccounts: AiChatAccount[];
    /** * A GitHub token is saved (Integrations → GitHub). */
    githubConnected: boolean;
    /** * Inputs of the session panel's token estimate (the prompt text itself stays on the server). */
    chatContext: AiChatContext;
    /** * The signed-in person's own chat customisation. */
    settings: AiChatSettings;
    /** * Safe account fields for the chat-settings dialog (never tokens). */
    aiAccountList: AiChatAccountList;
    /** * Integrations for the session panel; null without the `integrations.view` permission. */
    integrations: AiChatIntegration[] | null;
};

export type AiChatSettings = {
    custom_instructions: string | null;
    /** * How the AI addresses the person (null = the account name). */
    display_name: string | null;
    assistant_name: string | null;
    assistant_icon: string | null;
    assistant_color: string | null;
    /** * Route that serves the uploaded assistant avatar (with a cache-busting version), or null. Never a disk path. */
    avatar_url: string | null;
};

export type AiChatAccountRow = {
    id: number;
    name: string;
    vendor_key: string;
    vendor: string;
    /** * `connected|error|disconnected`. */
    status: string;
    enabled: boolean;
    /** * Lower runs first. */
    priority: number;
    /** * Purposes this account may serve; null = every purpose. */
    purposes: string[] | null;
    /** * The account's own model (null = the vendor default). */
    model: string | null;
    /** * Models offered for this account (the same list the composer uses). */
    models: { id: string; label: string }[];
};

/** * What answers a purpose: an account and, optionally, a model used for that purpose only (null = the account's own). */
export type AiChatPurposeChoice = {
    account_id: number;
    model: string | null;
};

export type AiChatAccountList = {
    accounts: AiChatAccountRow[];
    purposes: { key: string; label: string }[];
    /** * Purpose key => ordered accounts (with an optional model) that answer it: the first leads, the rest are fallbacks. Absent = automatic by priority. */
    purpose_accounts: Record<string, AiChatPurposeChoice[]>;
    /** * `integrations.view`: the "Thêm tài khoản" link. */
    can_view: boolean;
    /** * `integrations.update`: switches and saving the per-purpose choice. */
    can_update: boolean;
};

export type AiChatContext = {
    /** * Length in characters of the fixed system prompt. */
    system_chars: number;
    /** * Assumed context window in tokens. */
    window_tokens: number;
};

export type AiChatIntegration = {
    key: string;
    name: string;
    letter: string;
    color: string;
    /** * `connected|error|disconnected`. */
    status: string;
    status_label: string;
};

/** * One thing the app read for an answer: a file tree, a file, an attachment or a picture (names and counts only). */
export type AiChatActivityStep = {
    kind: string;
    source: string;
    detail: string;
};

export type AiChatSendResponse = {
    conversation: AiChatConversation;
    user_message: AiChatMessage;
    assistant_message: AiChatMessage;
    auto_pr_error?: string | null;
    activity?: AiChatActivityStep[];
};

/** * One account row of the "Thống kê AI" dialog (the call counts are the signed-in person's own). */
export type AiUsageAccount = {
    id: number;
    name: string;
    vendor_key: string;
    vendor: string;
    model: string | null;
    enabled: boolean;
    calls_24h: number;
    calls_7d: number;
    last_used_at: string | null;
    /** * Estimated tokens (about 4 characters each) of this person's calls; not the vendor's own count. */
    tokens_24h: number;
    tokens_7d: number;
    /** * The largest single request (estimated input tokens) in 7 days; null with no estimate yet. */
    largest_request: number | null;
    /** * The model's per-request context window, not a quota. */
    context_window: number;
    /** * Models this person used in 7 days, most used first. */
    models_used: string[];
    /** * `active|error|quota|unused|disabled`; `quota` only while the latest quota error is newer than the latest success. */
    status: string;
    status_at: string | null;
    /** * Limit state from real provider errors only (no remaining-quota numbers). */
    limit: AiAccountLimit;
};

export type AiUsageStats = {
    /** * false while the usage table does not exist yet. */
    available: boolean;
    accounts: AiUsageAccount[];
    /** * Assistant replies already in the chat history (no account is stored there, so they are not split per account). */
    history: { replies_24h: number; replies_7d: number };
};

/** * One agent working right now (a message that is out and not answered yet), shown in the composer's Agent list. */
export type AiAgentRun = {
    id: number;
    /** * The AI account answering. */
    name: string;
    /** * What it is doing now. */
    step: string;
    /** * The chat it works for (the start of the message). */
    task: string;
    /** * The conversation it answers in (the pending id until the first answer creates it): its row in Recents shows the working dots. */
    conversationId: string;
    startedAt: number;
};
