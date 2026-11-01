<?php

// * Own IMAP/SMTP mailbox client (Mail module). Named `mailbox` so it never collides with Laravel's `config/mail.php`.
return [
    // ! SSRF guard: when false, hosts that are or resolve to loopback/private/link-local/CGNAT/reserved addresses are refused.
    // ! Only enable for a self-hosted mail server on the local network.
    'allow_private_hosts' => (bool) env('MAIL_CLIENT_ALLOW_PRIVATE_HOSTS', false),

    // * First sync window per folder: newest `initial_limit` messages from the last `initial_days` days.
    'initial_days' => (int) env('MAIL_CLIENT_INITIAL_DAYS', 30),
    'initial_limit' => (int) env('MAIL_CLIENT_INITIAL_LIMIT', 500),

    // * Messages up to this size get their body cached during sync (peek); bigger ones are fetched when opened.
    'prefetch_max_bytes' => 262144,

    // * Stored body is cut at this many bytes and flagged `body_truncated`.
    'body_max_bytes' => 1048576,

    // * Newest local messages whose flags are re-read each sync (picks up read/unread changes made elsewhere).
    'flag_refresh_limit' => 200,

    // * Messages fetched per IMAP round trip while syncing.
    'batch_size' => 50,

    // * Seconds; applied to the socket connect and reads (TLS is always on and the certificate is always verified).
    'connect_timeout' => 15,

    'presets' => [
        'gmail' => [
            'label' => 'Gmail',
            'imap' => 'imap.gmail.com:993',
            'smtp' => 'smtp.gmail.com:587',
            // * Gmail files sent mail itself.
            'save_sent_copy' => false,
            'warning' => null,
        ],
        'outlook' => [
            'label' => 'Outlook / Microsoft 365',
            'imap' => 'outlook.office365.com:993',
            'smtp' => 'smtp.office365.com:587',
            'save_sent_copy' => true,
            'warning' => 'Microsoft có thể yêu cầu OAuth thay cho mật khẩu ứng dụng; khi đó hộp thư sẽ báo sai tài khoản hoặc mật khẩu.',
        ],
    ],
];
