<?php

return [
    'system_admin' => env('SYSTEM_ADMIN', 'admin@admin.com'),
    'app_password' => env('APP_PASSWORD'),

    // * Calendar day for Personal Manager modules (task due dates, dashboard summaries); `app.timezone` stays UTC.
    'personal_timezone' => 'Asia/Ho_Chi_Minh',
];
