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
    status: 'pending' | 'applied' | 'rejected';
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
    /** * Integrations for the session panel; null without the `integrations.view` permission. */
    integrations: AiChatIntegration[] | null;
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

export type AiChatSendResponse = {
    conversation: AiChatConversation;
    user_message: AiChatMessage;
    assistant_message: AiChatMessage;
    auto_pr_error?: string | null;
};
