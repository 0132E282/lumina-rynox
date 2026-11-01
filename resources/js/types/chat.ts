export type ConversationType = 'private' | 'group';
export type MessageDirection = 'in' | 'out';
export type MessageSenderType = 'customer' | 'staff' | 'system';
export type SendStatus = 'sending' | 'sent' | 'unknown' | 'failed';
export type ChatFilter = 'all' | 'unread';

export type Conversation = {
    /** * UUID. */
    id: string;
    /** * Set by the unified inbox, where a chat id and a mail id can be equal. */
    key?: string;
    provider: string;
    type: ConversationType;
    title: string;
    username: string | null;
    last_message_preview: string | null;
    last_message_direction: MessageDirection | null;
    /** * ISO 8601. */
    last_message_at: string | null;
    unread_count: number;
    /** * Global pin: pinned conversations are listed first for everyone. */
    pinned: boolean;
    /** * Relative URL of the stored profile picture (Messenger); null shows the initials. */
    avatar_url: string | null;
    /** * Account (Messenger or Zalo) the chat belongs to; null on Telegram. */
    account: {
        id: number;
        name: string | null;
        avatar_url: string | null;
    } | null;
};

export type ChatMessage = {
    id: number;
    direction: MessageDirection;
    sender_type: MessageSenderType;
    sender_name: string | null;
    body: string;
    /** * Inbound image served by an authenticated route; null when the message has none. */
    attachment: {
        url: string;
        width: number | null;
        height: number | null;
        /** * Original file name of a file staff sent; null for pictures. */
        name: string | null;
        size: number | null;
        is_image: boolean;
        is_audio: boolean;
        is_video: boolean;
    } | null;
    /** * Only outbound messages carry a send status. */
    send_status: SendStatus | null;
    error: string | null;
    /** * ISO 8601. */
    sent_at: string | null;
};

export type MessagePage = {
    data: ChatMessage[];
    has_more: boolean;
};

export type ChatChannel = {
    provider: string;
    name: string;
    status: 'connected' | 'error' | 'disconnected';
    connected: boolean;
    last_error: string | null;
    display_name: string | null;
    bot_username: string | null;
    /** * Name of the signed-in account on the channel (Zalo). */
    account: string | null;
    /** * Number of accounts of the channel (Zalo, Messenger; 0 on Telegram). */
    account_count: number;
    can_send: boolean;
};

export type ChatPageProps = {
    conversations: Conversation[];
    activeConversation: Conversation | null;
    messages: MessagePage;
    filters: { filter: ChatFilter; q: string };
    /** * The channel of the open conversation (Telegram while none is open). */
    channel: ChatChannel;
    channels: Record<string, ChatChannel>;
    unreadTotal: number;
    canReply: boolean;
    canReconnect: boolean;
};
