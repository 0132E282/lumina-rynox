/**
 * Opening a conversation reloads only the thread: the page stays mounted (sidebar tab, repo, expanded repos, search text and scroll are kept)
 * and the other props (recents list, accounts, settings) are not refetched. The list changes only when a chat is added or sent.
 */
export const OPEN_CONVERSATION_VISIT: {
    preserveState: boolean;
    preserveScroll: boolean;
    only: string[];
} = {
    preserveState: true,
    preserveScroll: true,
    only: ['activeConversation', 'messages'],
};
