<?php

// * Source of truth for the 14 integration providers: form fields, scopes, "how to connect" steps and risk flags.
// * Field `type`: text | secret | select. `secret` values are stored encrypted in `integrations.credentials`; the rest in `settings.fields`.
// * `unofficial` on a provider, field or permission means a non-official (personal-account) connection: a ToS warning and the
// * "I understand the risk" checkbox are required before saving. `test` names a real connection check (`telegram`, `zalo`, `matrix_bridge`, `ai`). `login` = `qr` means the connection is made by QR login (only `zalo`); `login` = `matrix_bridge` means sign-in happens on the bridge's Provisioning API (only `messenger`) and saving the form never sets `connected` by itself.
// * `active` is true only when real runtime code exists for the provider (Telegram và Zalo chat qua QR, LinkedIn/Facebook/Instagram posting, Email IMAP/SMTP); otherwise the form only stores config and the UI says "Đã lưu cấu hình" instead of "Đã kết nối". `messenger` keeps `active = false` until a user has tested it against a real bridge (see docs/repo/messenger-mautrix-runbook.md); the chat channel itself is always registered.
// * `manage_url` (email) means the provider has its own management screen: `/integrations/{provider}` redirects there and the overview status comes from that module's own table, not from `integrations`.
// * `category` points at a key of `categories`; the overview page `/integrations` groups cards by it. Order matters: it is the card order within a group. OAuth reconnect flows are not built yet, and QR exists only for Zalo, so the other providers only store the account label and scopes.

$securityNotes = [
    'Khoá và token được lưu mã hoá.',
    'Có thể ngắt kết nối bất cứ lúc nào.',
];

return [
    'unofficial_warning' => 'Kết nối không chính thức, có thể vi phạm điều khoản của nền tảng và bị khoá tài khoản.',

    'security_notes' => $securityNotes,

    // * Group headings of the overview page, in display order.
    'categories' => [
        'ai' => 'Trợ lý AI',
        'messaging' => 'Tin nhắn',
        'social' => 'Mạng xã hội & đăng bài',
        'calendar' => 'Lịch',
        'dev' => 'Lập trình',
    ],

    'providers' => [
        'ai' => [
            'name' => 'Trợ lý AI',
            'letter' => 'A',
            'category' => 'ai',
            'active' => true,
            'color' => '#8b5cf6',
            'test' => 'ai',
            'description' => 'Nhiều tài khoản Claude, OpenAI/Codex, Gemini hoặc DeepSeek (API token hoặc session token của CLI, thử lần lượt theo ưu tiên) để soạn nháp trả lời, viết bài nháp, báo cáo hằng ngày và trả lời trong thanh bên phải. Chỉ khi bật công tắc "Trả lời tự động" ở đầu trang, AI mới tự trả lời tin mới của khách; mặc định tắt.',
            'save_label' => 'Lưu kết nối',
            // * Accounts (API token or CLI session token) live in `ai_accounts`; only the report target is a provider-level setting.
            'page' => 'integrations/ai',
            'fields' => [
                ['key' => 'report_conversation_id', 'label' => 'Hội thoại nhận báo cáo', 'type' => 'text', 'required' => false, 'placeholder' => 'ID hội thoại trong /chat', 'hint' => 'Báo cáo 08:00 hằng ngày gửi vào hội thoại này (cần đã có sẵn); để trống thì không gửi'],
            ],
            'permissions' => [
                ['key' => 'suggest_reply', 'label' => 'Gợi ý trả lời trong khung chat', 'description' => 'AI đọc hội thoại đang mở và đề xuất, bạn bấm Dùng', 'default' => true],
                ['key' => 'filter_jobs', 'label' => 'Tự lọc việc làm phù hợp', 'description' => 'Chấm độ phù hợp giữa hồ sơ và tin tuyển dụng', 'default' => true],
                ['key' => 'summarize', 'label' => 'Tóm tắt email và tin nhắn', 'description' => 'Dùng cho trang Email, Lark và hội thoại', 'default' => true],
                ['key' => 'auto_send', 'label' => 'Tự động gửi tin nhắn cho khách', 'description' => 'Công tắc "Trả lời tự động" trên thanh đầu trang (một công tắc chung cho mọi kênh); tự tắt sau 3 lỗi liên tiếp', 'default' => false],
            ],
            'steps' => ['Thêm một hoặc nhiều tài khoản AI (API token hoặc session token), chọn mục đích và độ ưu tiên.', 'Bấm "Kiểm tra" ở từng tài khoản để thử một lần gọi ngắn.', 'Thanh AI bên phải, nút "Gợi ý AI" trong khung chat và báo cáo hằng ngày dùng cấu hình này; AI chỉ tự gửi tin khi bạn bật công tắc "Trả lời tự động".'],
        ],
        'github' => [
            'name' => 'GitHub',
            'letter' => 'G',
            'category' => 'dev',
            'active' => true,
            'color' => '#24292f',
            'test' => 'github',
            'description' => 'Kết nối GitHub bằng Personal Access Token chỉ đọc để trợ lý AI đọc repo (cây file, README, rule, skill, webhook, file bạn nhắc tên) khi review code. Không ghi, không commit, không đẩy code.',
            'save_label' => 'Lưu kết nối',
            'fields' => [
                ['key' => 'token', 'label' => 'Personal Access Token', 'type' => 'secret', 'required' => true, 'hint' => 'Tạo ở GitHub → Settings → Developer settings → Personal access tokens; chỉ cần quyền đọc nội dung (Contents: Read-only) và Metadata; thêm Webhooks: Read nếu muốn AI đọc webhook', 'pattern' => '/^(ghp_|github_pat_|gho_|ghs_)[A-Za-z0-9_]{20,}$/'],
            ],
            'permissions' => [
                ['key' => 'read_repo', 'label' => 'Đọc repo cho trợ lý AI', 'description' => 'AI chỉ đọc nội dung bạn chọn trong khung chat', 'default' => true],
            ],
            'steps' => ['Mở GitHub → Settings → Developer settings → Personal access tokens.', 'Tạo token chỉ đọc (Contents: Read-only, Metadata: Read-only; thêm Webhooks: Read nếu cần) cho các repo muốn dùng.', 'Dán token vào ô Personal Access Token rồi bấm Kiểm tra kết nối.'],
        ],
        'linkedin' => [
            'name' => 'LinkedIn',
            'letter' => 'L',
            'category' => 'social',
            'active' => true,
            'color' => '#0a66c2',
            'login' => 'oauth',
            'description' => 'Đăng nhập LinkedIn cá nhân để đăng và hẹn giờ đăng bài. Có thể dán token thủ công làm phương án dự phòng.',
            'save_label' => 'Lưu kết nối',
            'fields' => [
                ['key' => 'account', 'label' => 'Tài khoản', 'type' => 'text', 'required' => false, 'placeholder' => 'Tên hiển thị · Trang cá nhân'],
                ['key' => 'author_urn', 'label' => 'Author URN', 'type' => 'text', 'required' => true, 'placeholder' => 'urn:li:person:xxxx hoặc urn:li:organization:xxxx', 'hint' => 'Người hoặc trang sẽ đứng tên bài đăng'],
                ['key' => 'access_token', 'label' => 'Access token', 'type' => 'secret', 'required' => true, 'hint' => 'Cần quyền w_member_social (cá nhân) hoặc w_organization_social (trang). Token được lưu mã hoá'],
            ],
            'permissions' => [
                ['key' => 'publish', 'label' => 'Đăng bài', 'description' => 'Đăng bài thay mặt bạn', 'default' => true],
                ['key' => 'schedule', 'label' => 'Hẹn giờ đăng', 'description' => 'Hệ thống đăng đúng giờ đã đặt', 'default' => true],
                ['key' => 'read_comments', 'label' => 'Đọc bình luận', 'description' => 'Cần LinkedIn duyệt thêm quyền', 'default' => false],
            ],
            'steps' => [
                'Tạo ứng dụng tại LinkedIn Developers, thêm sản phẩm "Share on LinkedIn" và "Sign In with LinkedIn using OpenID Connect".',
                'Trong tab Auth, thêm Redirect URI: APP_URL/integrations/linkedin/oauth/callback.',
                'Đặt LINKEDIN_CLIENT_ID và LINKEDIN_CLIENT_SECRET (tuỳ chọn LINKEDIN_REDIRECT_URI) trong .env rồi tải lại cấu hình.',
                'Bấm "Đăng nhập với LinkedIn" và cho phép. Token hết hạn thì đăng nhập lại.',
            ],
        ],
        'zalo' => [
            'name' => 'Zalo',
            'letter' => 'Z',
            'category' => 'messaging',
            'active' => true,
            'color' => '#0068ff',
            'unofficial' => true,
            'login' => 'qr',
            // * Own Inertia page (accounts table + per-account scopes) instead of the generic `integrations/show` form.
            'page' => 'integrations/zalo',
            'test' => 'zalo',
            'description' => 'Đăng nhập tài khoản Zalo cá nhân bằng mã QR. Kết nối không chính thức.',
            'save_label' => 'Lưu kết nối',
            'fields' => [
                ['key' => 'group_mode', 'label' => 'Chế độ nhóm', 'type' => 'select', 'required' => false, 'options' => [
                    'mention_only' => 'Chỉ trả lời khi được mention',
                    'all' => 'Trả lời mọi tin nhắn trong nhóm',
                    'off' => 'Không trả lời trong nhóm',
                ]],
            ],
            'permissions' => [
                ['key' => 'receive', 'label' => 'Nhận tin nhắn', 'description' => 'Đưa tin vào khung chat', 'default' => true],
                ['key' => 'reply', 'label' => 'Trả lời tin nhắn', 'description' => 'Bot hoặc nhân viên trả lời', 'default' => true],
                ['key' => 'proactive', 'label' => 'Gửi tin chủ động', 'description' => '', 'default' => false],
            ],
            'steps' => ['Chạy Zalo bridge: npm --prefix zalo-bridge start.', 'Tick Tôi hiểu rủi ro, bấm Quét mã QR mới.', 'Mở Zalo trên điện thoại, quét mã và xác nhận đăng nhập.', 'Không mở Zalo Web ở nơi khác khi đang dùng kênh này.'],
        ],
        'messenger' => [
            'name' => 'Messenger cá nhân',
            'letter' => 'M',
            'category' => 'messaging',
            'active' => false,
            'color' => '#0084ff',
            'unofficial' => true,
            'login' => 'matrix_bridge',
            // * Own Inertia page (accounts table + per-account scopes) instead of the generic `integrations/show` form.
            'page' => 'integrations/messenger',
            'test' => 'matrix_bridge',
            'description' => 'Nhận và trả lời tin Messenger cá nhân qua mautrix-meta, đăng nhập bằng cookie facebook.com. Kết nối không chính thức.',
            'save_label' => 'Lưu kết nối',
            'fields' => [],
            'permissions' => [
                ['key' => 'receive', 'label' => 'Nhận tin nhắn', 'description' => 'Đưa tin vào khung chat', 'default' => true],
                ['key' => 'reply', 'label' => 'Trả lời tin nhắn', 'description' => 'Bot hoặc nhân viên trả lời', 'default' => true],
                ['key' => 'proactive', 'label' => 'Gửi tin chủ động', 'description' => '', 'default' => false],
            ],
            'steps' => [
                'Tự dựng Synapse và mautrix-meta theo docs/repo/messenger-mautrix-runbook.md.',
                'Mở facebook.com trong trình duyệt của bạn và đăng nhập (nên dùng tài khoản phụ, bật xác minh 2 bước).',
                'Mở Công cụ cho nhà phát triển > Application/Storage > Cookies > https://www.facebook.com, sao chép c_user, xs, datr, sb (và cookie khác nếu cần) thành chuỗi tên=giá_trị; tên=giá_trị.',
                'Dán chuỗi cookie vào ô bên dưới, tick Tôi hiểu rủi ro rồi bấm Đăng nhập.',
                'Không bấm Đăng xuất trên trình duyệt đã lấy cookie: đăng xuất làm cookie mất hiệu lực và kênh mất kết nối.',
            ],
        ],
        'whatsapp' => [
            'name' => 'WhatsApp',
            'letter' => 'W',
            'category' => 'messaging',
            'active' => false,
            'color' => '#10a05e',
            'unofficial' => true,
            'description' => 'Dự kiến kết nối WhatsApp cá nhân. Chưa hoạt động, hiện chỉ lưu cấu hình, chưa có đăng nhập QR.',
            'save_label' => 'Lưu kết nối',
            'fields' => [
                ['key' => 'account', 'label' => 'Tài khoản', 'type' => 'text', 'required' => false, 'placeholder' => 'Tên · +84 9xx xxx'],
            ],
            'permissions' => [
                ['key' => 'receive', 'label' => 'Nhận tin nhắn', 'description' => 'Đưa tin vào khung chat', 'default' => true],
                ['key' => 'reply', 'label' => 'Trả lời tin nhắn', 'description' => 'Bot hoặc nhân viên trả lời', 'default' => true],
            ],
            'steps' => ['Kênh này chưa hoạt động; bạn có thể lưu trước cấu hình, chưa nhận/gửi được tin.', 'Nhập nhãn tài khoản để lưu trước.', 'Chưa có đăng nhập bằng mã QR.'],
        ],
        'facebook' => [
            'name' => 'Facebook',
            'letter' => 'F',
            'category' => 'social',
            'active' => true,
            'color' => '#1877f2',
            'description' => 'Kết nối Fanpage (chính thức).',
            'test' => 'facebook',
            'save_label' => 'Lưu kết nối',
            'fields' => [
                ['key' => 'fanpage', 'label' => 'Fanpage', 'type' => 'text', 'required' => false, 'placeholder' => 'Tên Fanpage'],
                ['key' => 'page_id', 'label' => 'Page ID', 'type' => 'text', 'required' => false, 'hint' => 'Cần để đăng bài lên Fanpage'],
                ['key' => 'page_access_token', 'label' => 'Page access token', 'type' => 'secret', 'required' => false, 'hint' => 'Cần quyền pages_manage_posts. Token được lưu mã hoá'],
            ],
            'permissions' => [
                ['key' => 'page_messages', 'label' => 'Nhắn tin Fanpage', 'description' => 'Nhận và trả lời tin nhắn', 'default' => true],
                ['key' => 'page_publish', 'label' => 'Đăng bài lên Fanpage', 'description' => 'Dùng cho trang Bài viết', 'default' => true],
            ],
            'steps' => ['Đăng nhập Facebook.', 'Chọn Fanpage cần kết nối.', 'Đồng ý cấp quyền.'],
        ],
        'facebook_personal' => [
            'name' => 'Facebook cá nhân',
            'letter' => 'F',
            'category' => 'social',
            'active' => true,
            'unofficial' => true,
            'color' => '#1877f2',
            'description' => 'Đăng bài lên trang cá nhân bằng Chrome chạy trên máy này (không chính thức, cần máy bật, Chrome và Node; có thể bị Facebook hạn chế tài khoản).',
            'test' => 'facebook_personal',
            'save_label' => 'Lưu kết nối',
            'fields' => [],
            'permissions' => [
                ['key' => 'publish', 'label' => 'Đăng bài lên trang cá nhân', 'description' => 'Dùng cho trang Bài viết (chỉ văn bản)', 'default' => true, 'unofficial' => true],
            ],
            'steps' => ['Cài Google Chrome và Node trên máy chạy ứng dụng.', 'Chạy pnpm facebook:login rồi đăng nhập Facebook thủ công trong cửa sổ Chrome vừa mở.', 'Lưu kết nối rồi bấm Kiểm tra kết nối để xác nhận đã đăng nhập. Bài văn bản đầu tiên đăng qua giao diện Chrome và ghi nhớ mẫu request; các bài sau đăng bằng request từ máy chủ, Chrome chỉ chạy khi cần làm mới.'],
        ],
        'linkedin_personal' => [
            'name' => 'LinkedIn cá nhân',
            'letter' => 'L',
            'category' => 'social',
            'active' => true,
            'unofficial' => true,
            'color' => '#0a66c2',
            'description' => 'Đăng bài lên trang cá nhân bằng Chrome chạy trên máy này (không chính thức, cần máy bật, Chrome và Node). LinkedIn hạn chế tự động hoá trong điều khoản sử dụng: tài khoản có thể bị hạn chế hoặc khoá.',
            'test' => 'linkedin_personal',
            'save_label' => 'Lưu kết nối',
            'fields' => [],
            'permissions' => [
                ['key' => 'publish', 'label' => 'Đăng bài lên trang cá nhân', 'description' => 'Dùng cho trang Bài viết (văn bản và ảnh)', 'default' => true, 'unofficial' => true],
            ],
            'steps' => ['Cài Google Chrome và Node trên máy chạy ứng dụng.', 'Chạy pnpm linkedin:login rồi đăng nhập LinkedIn thủ công trong cửa sổ Chrome vừa mở.', 'Lưu kết nối rồi bấm Kiểm tra kết nối để xác nhận đã đăng nhập. Bài văn bản đầu tiên đăng qua giao diện Chrome và ghi nhớ mẫu request; các bài sau gửi request ngay trong Chrome. Giao diện LinkedIn chưa được kiểm với tài khoản thật.'],
        ],
        'instagram' => [
            'name' => 'Instagram',
            'letter' => 'I',
            'category' => 'social',
            'active' => true,
            'color' => '#c13584',
            'description' => 'Tài khoản chính thức qua Fanpage, tài khoản cá nhân qua đăng nhập.',
            'save_label' => 'Lưu kết nối',
            'fields' => [
                ['key' => 'official_account', 'label' => 'Tài khoản chính thức', 'type' => 'text', 'required' => false, 'placeholder' => 'Tên người dùng'],
                ['key' => 'ig_user_id', 'label' => 'Instagram user ID', 'type' => 'text', 'required' => false, 'hint' => 'Cần để đăng bài (tài khoản Business liên kết với Fanpage)'],
                ['key' => 'access_token', 'label' => 'Access token', 'type' => 'secret', 'required' => false, 'hint' => 'Cần quyền instagram_content_publish. Token được lưu mã hoá'],
                ['key' => 'personal_account', 'label' => 'Tài khoản cá nhân', 'type' => 'text', 'required' => false, 'unofficial' => true, 'hint' => 'Kết nối không chính thức, có thể bị khoá tài khoản'],
            ],
            'permissions' => [
                ['key' => 'messages', 'label' => 'Nhận và trả lời tin nhắn', 'description' => 'Đưa tin vào khung chat', 'default' => true],
                ['key' => 'publish', 'label' => 'Đăng bài', 'description' => 'Cần ít nhất một ảnh hoặc video', 'default' => true],
                ['key' => 'auto_send', 'label' => 'Tự động gửi tin', 'description' => 'Tắt mặc định', 'default' => false],
            ],
            'steps' => ['Chọn loại tài khoản.', 'Đăng nhập hoặc cấp quyền qua Fanpage.', 'Xử lý xác minh 2 bước nếu có.'],
        ],
        'telegram' => [
            'name' => 'Telegram',
            'letter' => 'T',
            'category' => 'messaging',
            'active' => true,
            'color' => '#229ed9',
            'description' => 'Kết nối bot bằng token từ BotFather.',
            'save_label' => 'Lưu kết nối',
            'test' => 'telegram',
            'fields' => [
                ['key' => 'display_name', 'label' => 'Tên hiển thị', 'type' => 'text', 'required' => false],
                ['key' => 'bot_token', 'label' => 'Bot token', 'type' => 'secret', 'required' => true, 'hint' => 'Lấy từ @BotFather', 'pattern' => '/^\d{5,}:[A-Za-z0-9_-]{20,}$/'],
            ],
            'permissions' => [
                ['key' => 'receive', 'label' => 'Nhận tin nhắn', 'description' => 'Đưa tin vào khung chat', 'default' => true],
                ['key' => 'send', 'label' => 'Gửi tin nhắn', 'description' => 'Bot trả lời khách', 'default' => true],
            ],
            'steps' => ['Mở Telegram, nhắn @BotFather.', 'Gửi lệnh /newbot.', 'Dán token vào ô Bot token.'],
        ],
        'discord' => [
            'name' => 'Discord',
            'letter' => 'D',
            'category' => 'messaging',
            'active' => false,
            'color' => '#5865f2',
            'description' => 'Dự kiến kết nối bot Discord. Chưa hoạt động, hiện chỉ lưu cấu hình.',
            'save_label' => 'Lưu kết nối',
            'fields' => [
                ['key' => 'application_id', 'label' => 'Application ID', 'type' => 'text', 'required' => true],
                ['key' => 'bot_token', 'label' => 'Bot token', 'type' => 'secret', 'required' => true],
                ['key' => 'channel', 'label' => 'Máy chủ và kênh', 'type' => 'text', 'required' => false, 'placeholder' => 'Tên máy chủ · #kênh'],
            ],
            'permissions' => [
                ['key' => 'receive', 'label' => 'Nhận tin nhắn', 'description' => 'Đưa tin vào khung chat', 'default' => true],
                ['key' => 'send', 'label' => 'Gửi tin nhắn', 'description' => 'Bot trả lời trong kênh', 'default' => true],
            ],
            'steps' => ['Kênh này chưa hoạt động; bạn có thể lưu trước cấu hình, chưa nhận/gửi được tin.', 'Tạo ứng dụng trong Discord Developer Portal, Reset Token ở mục Bot.', 'Dán token vào ô tương ứng để lưu trước.'],
        ],
        'lark' => [
            'name' => 'Lark',
            'letter' => 'L',
            'category' => 'messaging',
            'active' => false,
            'color' => '#3370ff',
            'description' => 'Dự kiến kết nối ứng dụng Lark để đồng bộ công việc và lịch. Chưa hoạt động, hiện chỉ lưu cấu hình.',
            'save_label' => 'Lưu kết nối',
            'fields' => [
                ['key' => 'workspace', 'label' => 'Tên workspace', 'type' => 'text', 'required' => false],
                ['key' => 'app_id', 'label' => 'App ID', 'type' => 'text', 'required' => true],
                ['key' => 'app_secret', 'label' => 'App Secret', 'type' => 'secret', 'required' => true],
            ],
            'permissions' => [
                ['key' => 'tasks', 'label' => 'Công việc', 'description' => 'Đồng bộ task hai chiều', 'default' => true],
                ['key' => 'calendar', 'label' => 'Lịch', 'description' => 'Đưa lịch họp vào trang Lịch', 'default' => true],
                ['key' => 'messages', 'label' => 'Tin nhắn', 'description' => 'Nhận thông báo và tin nhóm', 'default' => false],
            ],
            'steps' => ['Kênh này chưa hoạt động; bạn có thể lưu trước cấu hình, chưa nhận/gửi được tin.', 'Mở Lark Developer Console, lấy App ID và App Secret.', 'Dán vào các ô bên trái để lưu trước.'],
        ],
        'email' => [
            'name' => 'Email',
            'letter' => 'E',
            'category' => 'messaging',
            'active' => true,
            'manage_url' => '/mail/accounts',
            'color' => '#e5484d',
            'description' => 'Đọc, tìm và trả lời thư của nhiều hộp thư (Gmail, Outlook, IMAP khác) bằng mật khẩu ứng dụng qua IMAP/SMTP.',
            'save_label' => 'Lưu hộp thư',
            'fields' => [],
            'permissions' => [],
            'steps' => ['Mở trang Hộp thư và bấm Thêm hộp thư.', 'Tạo mật khẩu ứng dụng cho hộp thư (cần bật xác minh 2 bước).', 'Nhập địa chỉ, mật khẩu ứng dụng, máy chủ IMAP/SMTP rồi bấm Kiểm tra kết nối.'],
        ],
        'gcal' => [
            'name' => 'Google Calendar',
            'letter' => 'G',
            'category' => 'calendar',
            'active' => false,
            'color' => '#4285f4',
            'description' => 'Dự kiến đồng bộ Google Calendar. Chưa hoạt động, hiện chỉ lưu cấu hình, chưa có đăng nhập Google.',
            'save_label' => 'Lưu kết nối',
            'fields' => [
                ['key' => 'calendar', 'label' => 'Lịch đồng bộ', 'type' => 'text', 'required' => false, 'placeholder' => 'Lịch chính'],
                ['key' => 'sync_direction', 'label' => 'Hướng đồng bộ', 'type' => 'select', 'required' => false, 'options' => [
                    'both' => 'Hai chiều',
                    'pull' => 'Chỉ lấy về',
                    'push' => 'Chỉ đẩy đi',
                ]],
            ],
            'permissions' => [
                ['key' => 'read', 'label' => 'Đọc lịch', 'description' => 'Hiện sự kiện trên trang Lịch', 'default' => true],
                ['key' => 'write', 'label' => 'Tạo và sửa sự kiện', 'description' => 'Đẩy lịch phỏng vấn và họp', 'default' => true],
            ],
            'steps' => ['Kênh này chưa hoạt động; bạn có thể lưu trước cấu hình, chưa nhận/gửi được tin.', 'Nhập tên lịch và hướng đồng bộ để lưu trước.', 'Chưa có đăng nhập bằng Google.'],
        ],
    ],
];
