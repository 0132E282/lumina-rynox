import { DEFAULT_LIMITS } from '../shared/limits.mjs';

// ! Every selector/text LinkedIn can change lives here (Vietnamese + English). Fix a break in this block only. UNVERIFIED.
export const LINKEDIN = {
    groupsUrl: 'https://www.linkedin.com/groups/',
    // * Group links look like /groups/<numeric id>/; anything else under /groups/ is not a group.
    groupPath: /^\/groups\/(\d{3,15})\/?$/,
    groupLinkLabel: /^(xem nhóm|view group|vào nhóm|join|tham gia)$/i,
    // * Group posting (bulk). ALL UNVERIFIED against the live site: the group page's own composer trigger and its text/wording.
    groupPostUrl: /^https:\/\/www\.linkedin\.com\/groups\/\d{3,15}\/?$/,
    groupComposerTrigger:
        /bắt đầu thảo luận|bắt đầu bài đăng|start a conversation|start a post|start a discussion/i,
    homeUrl: 'https://www.linkedin.com/feed/',
    loginSessionCookie: 'li_at', // * only its presence is tested, the value is never read or printed
    csrfCookie: 'JSESSIONID', // * read in the page for the csrf-token header, never stored or printed
    loginUrl: /\/(login|uas\/login|authwall|signup)\b/i,
    checkpointUrl: /\/(checkpoint|challenge)\b|captcha/i,
    checkpointText:
        /xác minh bạn là người thật|kiểm tra bảo mật nhanh|quick security check|let(?:'|’)s do a quick security check|verify you(?:'|’)re (?:a )?human/i,
    composerTrigger: /bắt đầu bài đăng|start a post/i,
    composerTextbox: 'textbox',
    // * The visibility control of the composer; its text is "Mọi người" / "Anyone" (optionally preceded by a prefix).
    audienceButton:
        /mọi người|anyone|chỉ kết nối|connections only|ai có thể xem bài đăng|who can see your post|cài đặt bài đăng|post settings/i,
    audienceButtonPrefix:
        /^(ai có thể xem bài đăng của bạn\??|who can see your post\??|cài đặt bài đăng|post settings|chọn đối tượng|select audience|đăng cho|post to)\s*/i,
    audiencePopupTitle:
        /^(ai có thể xem bài đăng của bạn\??|who can see your post\??)$/i,
    audienceDone: /^(xong|done|lưu|save)$/i,
    audienceOptions: {
        public: /^(mọi người|anyone)/i,
        connections: /^(chỉ kết nối|connections only|kết nối|connections)/i,
    },
    photoButton: /thêm ảnh|add a photo|add photo/i,
    // * After choosing files LinkedIn shows an editor step with "Tiếp"/"Next"; the composer comes back after it.
    editorNext: /^(tiếp|next)$/i,
    // * Thumbnails are blob: previews (avatars are not); the remove-button of an attachment must be there too.
    attachmentRemove:
        /xóa ảnh|xoá ảnh|gỡ ảnh|loại bỏ ảnh|remove (?:photo|image|media)|delete (?:photo|image)/i,
    attachmentImage: 'img[src^="blob:"]',
    submitButton: /^(đăng|post)$/i,
    publishedToast: /đăng bài thành công|đã đăng|post successful/i,
    justNow: /vừa xong|just now/i,
    feedPost: '[data-urn^="urn:li:activity"], [role="article"]',
    viewPostLink: /xem bài đăng|view post/i,
    postUrnPattern: /urn:li:(?:share|ugcPost|activity):\d{5,30}/,
    postUrlPath: /^\/feed\/update\//,
    // * In-browser API replay. A captured request is recognised by path, JSON body and by finding the typed text and visibility by value.
    apiPathPattern: /^\/voyager\/api\/[A-Za-z0-9_\-./?=&%:,()@]{1,400}$/,
    // * `learn` blocks any POST under this path whose body carries LEARN_MARKER.
    apiRoute: '**/voyager/api/**',
    apiPathHint: /contentcreation|sharing|shares|posts?\b/i,
    replayHeaders: [
        'content-type',
        'accept',
        'x-restli-protocol-version',
        'x-li-lang',
        'x-li-track',
    ],
    csrfHeader: 'csrf-token',
    // * Visibility values as the composer's own request carries them; only the observed one per audience is stored and replayed.
    apiVisibility: {
        public: /^(ANYONE|PUBLIC)$/i,
        connections: /^(CONNECTIONS(?:_ONLY)?)$/i,
    },
    uuidPattern:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    // * Keys whose non-empty value ties a template to one specific post (media, mentions/hashtag entities): never templated.
    unsafeVariableKeys:
        /^(media|mediaUrns?|mediaCategory|attributes|attributesV2|attachments?|originalShare|reshare\w*|poll\w*|article\w*|document\w*)$/i,
};

export const LINKEDIN_LIMITS = { ...DEFAULT_LIMITS, imageMaxCount: 9 };

export const LEARN_MARKER = 'linkedin-learn-do-not-post';
