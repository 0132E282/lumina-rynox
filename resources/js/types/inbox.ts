import type {
    ChatChannel,
    ChatFilter,
    Conversation,
    MailShowProps,
    MessagePage,
} from '@/types';

/** * `all` plus the channel keys the server returns (`email` or a chat provider). */
export type InboxChannelKey = string;

export type InboxChannelTab = {
    key: InboxChannelKey;
    label: string;
    /** * Unread messages in this channel; 0 hides the badge. */
    unread: number;
};

/** * A row of the merged list: a chat conversation or an INBOX mail, shaped like a conversation. */
/** * Mail rows keep their numeric id, so `id` is a chat UUID or a mail id (tell them apart with `kind`). */
export type InboxItem = Omit<Conversation, 'id'> & {
    id: string | number;
    key: string;
    kind: 'chat' | 'mail';
    channel: InboxChannelKey;
    connected: boolean;
    account_count: number;
};

export type InboxPage = {
    data: InboxItem[];
    current_page: number;
    last_page: number;
    total: number;
};

export type InboxPageProps = {
    items: InboxPage;
    channelTabs: InboxChannelTab[];
    filters: { channel: InboxChannelKey; filter: ChatFilter; q: string };
    channels: Record<string, ChatChannel>;
    activeConversation: Conversation | null;
    messages: MessagePage;
    /** * The channel of the open conversation; null while none (or a mail) is open. */
    channel: ChatChannel | null;
    mailThread: Pick<
        MailShowProps,
        | 'message'
        | 'thread'
        | 'outbox'
        | 'mailbox'
        | 'reply_defaults'
        | 'show_images'
        | 'can'
    > | null;
    activeMailId: number | null;
    can: {
        chat: boolean;
        mail: boolean;
        reply: boolean;
        reconnect: boolean;
        manage_mailboxes: boolean;
    };
};
