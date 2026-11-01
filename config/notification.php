<?php

return [
    'templates' => [
        'admin_logged_in' => [
            'subject' => env('NOTIFICATION_LOGIN_SUBJECT', 'Đăng nhập thành công'),
            'greeting' => env('NOTIFICATION_LOGIN_GREETING', 'Xin chào :name,'),
            'line' => env('NOTIFICATION_LOGIN_LINE', 'Bạn vừa đăng nhập vào hệ thống từ IP :ip.'),
            'warning' => env('NOTIFICATION_LOGIN_WARNING', 'Nếu không phải bạn, hãy đổi mật khẩu ngay.'),
        ],
        'admin_account_created' => [
            'subject' => env('NOTIFICATION_ACCOUNT_CREATED_SUBJECT', 'Tài khoản quản trị viên của bạn đã được tạo'),
            'greeting' => env('NOTIFICATION_ACCOUNT_CREATED_GREETING', 'Xin chào :name,'),
            'line' => env('NOTIFICATION_ACCOUNT_CREATED_LINE', 'Một tài khoản quản trị viên đã được tạo cho bạn trong hệ thống.'),
            'action' => env('NOTIFICATION_ACCOUNT_CREATED_ACTION', 'Đăng nhập ngay'),
        ],
    ],
];
