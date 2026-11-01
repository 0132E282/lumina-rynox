// ThreadType của zca-js (models/Enum.d.ts): User = 0, Group = 1.
export const THREAD_TYPE_GROUP = 1;

// Suy ra từ tên msgType Zalo thường gặp, KHÔNG có trong .d.ts của zca-js; mã lạ rơi về 'other'.
const CONTENT_TYPES = {
    'chat.photo': 'image',
    'chat.sticker': 'sticker',
    'share.file': 'file',
    'chat.voice': 'voice',
    'chat.video.msg': 'video',
    'chat.recommended': 'link',
    'chat.link': 'link',
};

/** Ánh xạ message zca-js sang hợp đồng /internal/zalo/inbound. Trả null nếu không dùng được. */
export function normalizeMessage(message, ownUid) {
    const data = message?.data;
    if (
        !data ||
        data.msgId === undefined ||
        data.msgId === null ||
        !message.threadId
    ) {
        return null;
    }

    const isGroup = message.type === THREAD_TYPE_GROUP;
    const isText = typeof data.content === 'string';
    const senderName =
        typeof data.dName === 'string' && data.dName !== '' ? data.dName : null;
    const mentions = Array.isArray(data.mentions) ? data.mentions : [];
    const sentAt = Number(data.ts);

    return {
        message_id: String(data.msgId),
        thread_id: String(message.threadId),
        thread_type: isGroup ? 'group' : 'user',
        thread_name: null,
        sender_id: String(data.uidFrom ?? ''),
        sender_name: senderName,
        is_self: message.isSelf === true,
        content_type: isText
            ? 'text'
            : (CONTENT_TYPES[data.msgType] ?? 'other'),
        text: isText ? data.content : null,
        mentions_self:
            isGroup &&
            ownUid !== null &&
            ownUid !== undefined &&
            mentions.some((mention) => String(mention?.uid) === String(ownUid)),
        sent_at_ms: Number.isFinite(sentAt) ? sentAt : Date.now(),
    };
}
