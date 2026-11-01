import { DEFAULT_LIMITS } from '../shared/limits.mjs';

// ! Every selector/text Facebook can change lives here (Vietnamese + English). Fix a break in this block only.
export const FACEBOOK = {
    groupsUrl: 'https://www.facebook.com/groups/joins/',
    // * Group links look like /groups/<id>/; anything else under /groups/ (feed, discover, joins, create...) is not a group.
    groupPath: /^\/groups\/([A-Za-z0-9.]{3,100})\/?$/,
    // * Group posting (bulk). ALL UNVERIFIED against the live site: the group page's own composer trigger/textbox wording.
    groupPostUrl:
        /^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9.]{3,100}\/?$/,
    groupComposerTrigger:
        /viết gì đó|bạn viết gì đi|write something|create a public post|tạo bài viết công khai/i,
    groupComposerTextbox:
        /viết gì đó|bạn viết gì đi|write something|tạo bài viết công khai|create a public post/i,
    groupLinkLabel: /^(xem nhóm|view group|vào nhóm|join|tham gia)$/i,
    homeUrl: 'https://www.facebook.com/',
    loginSessionCookie: 'c_user', // * only its presence is tested, the value is never read or printed
    checkpointUrl:
        /\/(checkpoint|two_step_verification|login\/identify|recover)\b|captcha/i,
    checkpointText:
        /xác nhận bạn là người thật|confirm you(?:'|’)re human|security check|kiểm tra bảo mật/i,
    composerTrigger: /bạn đang nghĩ gì|what(?:'|’)s on your mind/i,
    composerTextbox:
        /bạn đang nghĩ gì|what(?:'|’)s on your mind|tạo bài viết công khai|create a public post/i,
    audienceButton:
        /chỉnh sửa quyền riêng tư|edit privacy|chọn đối tượng|select audience|chỉ mình tôi|only me|bạn bè|friends|công khai|public/i,
    // * The audience button reads "Đối tượng của bài viết Công khai": the prefix is dropped before the label is compared.
    audienceButtonPrefix:
        /^(đối tượng của bài viết|đối tượng|post audience|audience)\s*/i,
    audienceDone: /^(xong|done|lưu|save)$/i,
    audienceOptions: {
        self: /^(chỉ mình tôi|only me)/i,
        friends: /^(bạn bè|friends)(?!.*(ngoại trừ|except|cụ thể|specific))/i,
        public: /^(công khai|public)/i,
    },
    // * With an image attached the primary button reads "Tiếp" (Next); a final screen then has "Đăng" (Post).
    nextButton: /^(tiếp|next)$/i,
    submitButton: /^(đăng|post)$/i,
    photoButton:
        /ảnh\/video|ảnh hoặc video|photo\/video|photo or video|add photos?\/videos?/i,
    // * Thumbnails are blob: previews (avatars are not); the remove-button of an attachment must be there too.
    attachmentRemove:
        /gỡ ảnh|xóa ảnh|xoá ảnh|gỡ video|remove photo|remove video|remove attachment|remove$/i,
    attachmentImage: 'img[src^="blob:"]',
    publishedToast:
        /đã đăng|bài viết của bạn (?:đã|hiện)|your post is now published|posted/i,
    justNow: /vừa xong|just now/i,
    viewPostLink: /xem bài viết|view post|xem$|^view$/i,
    postUrlParams: ['story_fbid', 'id', 'fbid'],
    // * Extraction of the page tokens Laravel's plain GraphQL request needs, and how the composer's own request is recognised.
    dtsgPatterns: [
        /"DTSGInitialData"[^}]*?"token":"([^"]+)"/,
        /name="fb_dtsg" value="([^"]+)"/,
    ],
    lsdPatterns: [/"LSD"[^}]*?"token":"([^"]+)"/, /name="lsd" value="([^"]+)"/],
    jazoestPattern: /name="jazoest" value="(\d+)"/,
    graphqlPath: '/api/graphql',
    composerFriendlyName: /ComposerStoryCreate/i,
    docIdPattern: /^\d{5,30}$/,
    // * In-browser API replay. Params re-read from the live page every time (never stored in the template).
    apiPath: '/api/graphql/',
    volatileParams: [
        'fb_dtsg',
        'lsd',
        'jazoest',
        '__user',
        'av',
        'variables',
        '__req',
    ],
    apiPrivacy: { self: 'SELF', friends: 'FRIENDS', public: 'EVERYONE' },
    uuidPattern:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    // * Keys whose non-empty value ties a template to one specific post (link preview/media/mention offsets): never templated.
    unsafeVariableKeys: /^(attachments?|ranges)$/i,
    postIdKeys: ['post_id', 'legacy_story_hideable_id'],
    postIdPattern: /^[A-Za-z0-9_=-]{1,100}$/,
};

export const FACEBOOK_LIMITS = {
    ...DEFAULT_LIMITS,
    imageMaxCount: 10, // * keep in sync with Post::MAX_MEDIA
};
