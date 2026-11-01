<?php

// * Source of truth for the admin sidebar and the `/system` shortcuts grid.
return [
    'sidebar' => [
        // * Groups render as the icon rail; a group with a single item links straight to its page, otherwise it opens a panel.
        'main' => [
            [
                'key' => 'ai',
                'title' => 'Trợ lý AI',
                'icon' => 'Sparkles',
                'items' => [
                    [
                        'title' => 'Trợ lý AI',
                        'url' => '/',
                        'icon' => 'Sparkles',
                    ],
                ],
            ],
            [
                'key' => 'overview',
                'title' => 'Dashboard',
                'icon' => 'LayoutDashboard',
                'items' => [
                    [
                        'title' => 'Dashboard',
                        'url' => '/dashboard',
                        'icon' => 'LayoutDashboard',
                    ],
                ],
            ],
            [
                'key' => 'communication',
                'title' => 'Hộp thoại',
                'icon' => 'MessageSquare',
                'items' => [
                    [
                        'title' => 'Hộp thư chung',
                        'url' => '/inbox',
                        'icon' => 'MessageSquare',
                        // * `CmsServiceProvider` fills `badge` with the unread chat conversations plus unread INBOX mail.
                        'badge_source' => 'inbox_unread',
                    ],
                ],
            ],
            [
                'key' => 'work',
                'title' => 'Tìm việc',
                'icon' => 'ListChecks',
                'submenu' => true,
                'items' => [
                    [
                        'title' => 'Việc làm',
                        'url' => '/jobs',
                        'icon' => 'BriefcaseBusiness',
                    ],
                    [
                        'title' => 'Nơi tìm việc',
                        'url' => '/jobs/sources',
                        'icon' => 'Search',
                    ],
                    [
                        'title' => 'CV',
                        'url' => '/cvs',
                        'icon' => 'FileText',
                    ],
                ],
            ],
            [
                'key' => 'calendar',
                'title' => 'Lịch',
                'icon' => 'CalendarDays',
                'items' => [
                    [
                        'title' => 'Lịch',
                        'url' => '/calendar',
                        'icon' => 'CalendarDays',
                    ],
                ],
            ],
            [
                'key' => 'social',
                'title' => 'Mạng xã hội',
                'icon' => 'Globe',
                // * Shown as a secondary menu (folds open under one entry) instead of flat entries.
                'submenu' => true,
                'items' => [
                    [
                        'title' => 'Bài viết',
                        'url' => '/posts',
                        'icon' => 'PenLine',
                    ],
                    [
                        'title' => 'Nhóm',
                        'url' => '/social-groups',
                        'icon' => 'Users',
                    ],
                ],
            ],
            [
                'key' => 'integrations',
                'title' => 'Tích hợp',
                'icon' => 'Plug',
                'items' => [
                    ['title' => 'Tích hợp', 'url' => '/integrations', 'icon' => 'Plug'],
                ],
            ],
        ],
    ],

    'systems' => [
        [
            'key' => 'admins',
            'title' => 'Quản lý Admin',
            'description' => 'Danh sách quản trị viên, phân quyền theo vai trò.',
            'url' => '/admins',
            'icon' => 'Users',
        ],
        [
            'key' => 'roles',
            'title' => 'Quản lý Vai trò',
            'description' => 'Vai trò, quyền hạn và phân quyền thư mục.',
            'url' => '/roles',
            'icon' => 'ShieldCheck',
        ],
        [
            'key' => 'activity-logs',
            'title' => 'Lịch sử hoạt động',
            'description' => 'Nhật ký tạo/sửa/xóa Admin, Vai trò và đăng nhập hệ thống.',
            'url' => '/activity-logs',
            'icon' => 'History',
        ],
        [
            'key' => 'general-settings',
            'title' => 'Cấu hình hệ thống',
            'description' => 'Tên website, logo và favicon hiển thị trên toàn hệ thống.',
            'url' => '/settings/general',
            'icon' => 'SlidersHorizontal',
        ],
        [
            'key' => 'smtp-settings',
            'title' => 'Cấu hình SMTP',
            'confirmPassword' => true,
            'description' => 'Máy chủ gửi email cho thông báo và xác thực tài khoản.',
            'url' => '/settings/smtp',
            'icon' => 'Mail',
        ],
        [
            'key' => 'search-console-settings',
            'title' => 'Google Search Console',
            'confirmPassword' => true,
            'description' => 'Kiểm tra trạng thái index của URL qua Search Console.',
            'url' => '/settings/search-console',
            'icon' => 'Search',
        ],
        [
            'key' => 'log-viewer',
            'title' => 'Log Viewer',
            'confirmPassword' => true,
            'description' => 'Xem log lỗi/hoạt động của ứng dụng (laravel.log).',
            'url' => '/log-viewer',
            'icon' => 'FileText',
        ],
        [
            'key' => 'api-keys',
            'title' => 'Quản lý API Keys',
            'confirmPassword' => true,
            'description' => 'Tạo và quản lý API Key. Key chưa được dùng để xác thực /api/items; API này chỉ dùng phiên đăng nhập.',
            'url' => '/api-keys',
            'icon' => 'Key',
        ],
    ],
];
