// Giới hạn để một danh bạ lớn không làm phình response/bộ nhớ; vượt thì cắt và báo `truncated`.
export const MAX_FRIENDS = 5000;
export const MAX_GROUPS = 500;
export const GROUP_CHUNK_SIZE = 50;
export const MAX_NAME_LENGTH = 255;

/**
 * Lấy danh bạ bằng đúng các hàm zca-js đã xác minh (xem plan, spikeResult.contacts):
 * - api.getAllFriends(count, page): User[] (1 request);
 * - api.getAllGroups(): { version, gridVerMap: { [groupId]: version } } (chỉ có id);
 * - api.getGroupInfo(ids[]): { gridInfoMap: { [groupId]: { name, ... } } } (theo lô, nghỉ giữa các lô).
 * Chỉ trả {thread_id, type, name}; không lấy số điện thoại, avatar, thành viên.
 */
export async function fetchContacts(
    api,
    { chunkSize = GROUP_CHUNK_SIZE, gapMs = 1000, sleep = defaultSleep } = {},
) {
    const friendsRaw = await api.getAllFriends(MAX_FRIENDS, 1);
    const friends = [];
    for (const user of Array.isArray(friendsRaw) ? friendsRaw : []) {
        const id = toId(user?.userId);
        if (id === null) {
            continue;
        }
        friends.push({
            thread_id: id,
            type: 'user',
            name: cleanName(user.displayName) || cleanName(user.zaloName),
        });
    }

    const groupMap = (await api.getAllGroups())?.gridVerMap;
    const allGroupIds =
        groupMap !== null && typeof groupMap === 'object'
            ? Object.keys(groupMap)
            : [];
    const groupIds = allGroupIds.slice(0, MAX_GROUPS);
    const groups = [];
    for (let start = 0; start < groupIds.length; start += chunkSize) {
        if (start > 0) {
            await sleep(gapMs);
        }
        const chunk = groupIds.slice(start, start + chunkSize);
        const info = (await api.getGroupInfo(chunk))?.gridInfoMap ?? {};
        for (const groupId of chunk) {
            groups.push({
                thread_id: groupId,
                type: 'group',
                name: cleanName(info[groupId]?.name),
            });
        }
    }

    return {
        contacts: [...friends, ...groups],
        friends: friends.length,
        groups: groups.length,
        truncated:
            friendsRaw?.length > MAX_FRIENDS || allGroupIds.length > MAX_GROUPS,
    };
}

function toId(value) {
    const id = typeof value === 'number' ? String(value) : value;
    return typeof id === 'string' && id !== '' && id.length <= 64 ? id : null;
}

function cleanName(value) {
    return typeof value === 'string'
        ? value.trim().slice(0, MAX_NAME_LENGTH)
        : '';
}

function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
