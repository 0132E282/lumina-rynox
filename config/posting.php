<?php

use App\Models\PostTarget;
use App\Services\Posting\FacebookPersonalPublisher;
use App\Services\Posting\FacebookPublisher;
use App\Services\Posting\InstagramPublisher;
use App\Services\Posting\LinkedInPersonalPublisher;
use App\Services\Posting\LinkedInPublisher;

// * Cross-platform posting (`/posts`). Credentials live in the `integrations` table (config/integrations.php defines the form);
// * this file only holds per-platform limits and the API versions the publishers call.
return [
    // * A scheduled post later than this (minutes) is never published automatically: it becomes `missed` and needs a manual decision (D8).
    'late_after_minutes' => 60,

    // * A `publishing` target/post idle this long lost its worker; the outcome is unknown, so it is shown as such, never retried.
    'stale_publishing_minutes' => 10,

    'http_timeout_seconds' => 20,
    'http_connect_timeout_seconds' => 5,

    // * `facebook_personal`: the personal-timeline publisher runs scripts/facebook-post.mjs on this machine (needs Chrome + node).
    'facebook_personal' => [
        'node_binary' => env('FACEBOOK_PERSONAL_NODE_BINARY', 'node'),
        'timeout_seconds' => 180,
        // * Written by the script (cookie header, tokens, request template; 0600), gitignored under storage/app. Read by the HTTP tier.
        'session_file' => storage_path('app/facebook-session.json'),
        // * Hidden Chrome (no window). Plain headless only, nothing is disguised; Facebook may challenge it more often, and a checkpoint then needs a visible run.
        'headless' => (bool) env('FACEBOOK_PERSONAL_HEADLESS', false),
    ],

    // * `linkedin_personal`: same idea as `facebook_personal`, scripts/linkedin-post.mjs on this machine (needs Chrome + node).
    'linkedin_personal' => [
        'node_binary' => env('LINKEDIN_PERSONAL_NODE_BINARY', 'node'),
        'timeout_seconds' => 180,
        // * Written by the script (captured request template; 0600), gitignored under storage/app. Never read by Laravel.
        'session_file' => storage_path('app/linkedin-session.json'),
        // * Hidden Chrome (no window). Plain headless only, nothing is disguised; a checkpoint then needs a visible run.
        'headless' => (bool) env('LINKEDIN_PERSONAL_HEADLESS', false),
        // * Browser cookie string (`li_at=...; JSESSIONID="ajax:..."`) of the LinkedIn account. When set, public text-only feed posts go straight
        // * to LinkedIn's web endpoint over HTTP (no Chrome); anything else still uses the script. Keep it in .env only, it is a login key.
        'web_cookie' => env('LINKEDIN_PERSONAL_COOKIE'),
        // * Written by the script after a login (0600, gitignored under storage/app); used when LINKEDIN_PERSONAL_COOKIE is empty.
        'cookie_file' => storage_path('app/linkedin-cookie.json'),
    ],

    // * Bulk posting into saved groups of the personal accounts. Targets go one after another (never in parallel); the hourly cap is the
    // * provider's own `posts_per_hour` below (feed posts and group posts share it). Pause between two groups of one provider, in seconds.
    'group_posting' => [
        'delay_min_seconds' => (int) env('GROUP_POST_DELAY_MIN_SECONDS', 90),
        'delay_max_seconds' => (int) env('GROUP_POST_DELAY_MAX_SECONDS', 240),
    ],

    'graph_version' => 'v23.0',
    'linkedin_version' => '202511',

    // * `integration` is the key in config/integrations.php, `permission` the scope that must be ticked for posting.
    // * `max_length` is the character limit of the platform; `media_types` what the publisher can attach.
    'providers' => [
        'linkedin' => [
            'label' => 'LinkedIn',
            'integration' => 'linkedin',
            'permission' => 'publish',
            'max_length' => 3000,
            'media_types' => ['image'],
            'requires_media' => false,
            'publisher' => LinkedInPublisher::class,
        ],
        'facebook' => [
            'label' => 'Facebook Fanpage',
            'integration' => 'facebook',
            'permission' => 'page_publish',
            'max_length' => 3000,
            'media_types' => ['image', 'video'],
            'requires_media' => false,
            'publisher' => FacebookPublisher::class,
        ],
        // ! Unofficial: drives a real Chrome on this machine, text and images (no video), may break when Facebook changes its page or get the account restricted.
        'facebook_personal' => [
            'label' => 'Facebook cá nhân',
            'integration' => 'facebook_personal',
            'permission' => 'publish',
            'max_length' => 3000,
            'media_types' => ['image'],
            'requires_media' => false,
            // * Allowed audiences with their labels, per provider; the first one is the default.
            'audiences' => [
                PostTarget::AUDIENCE_SELF => 'Chỉ mình tôi',
                PostTarget::AUDIENCE_FRIENDS => 'Bạn bè',
                PostTarget::AUDIENCE_PUBLIC => 'Công khai',
            ],
            'posts_per_hour' => (int) env('FACEBOOK_PERSONAL_POSTS_PER_HOUR', 5),
            'publisher' => FacebookPersonalPublisher::class,
        ],
        // ! Unofficial and against LinkedIn's terms on automation: drives a real Chrome on this machine, text and images (no video); the account may be restricted.
        'linkedin_personal' => [
            'label' => 'LinkedIn cá nhân',
            'integration' => 'linkedin_personal',
            'permission' => 'publish',
            'max_length' => 3000,
            'media_types' => ['image'],
            'requires_media' => false,
            'audiences' => [
                PostTarget::AUDIENCE_PUBLIC => 'Mọi người',
                PostTarget::AUDIENCE_CONNECTIONS => 'Kết nối',
            ],
            'posts_per_hour' => (int) env('LINKEDIN_PERSONAL_POSTS_PER_HOUR', 3),
            'publisher' => LinkedInPersonalPublisher::class,
        ],
        'instagram' => [
            'label' => 'Instagram',
            'integration' => 'instagram',
            'permission' => 'publish',
            'max_length' => 2200,
            'media_types' => ['image'],
            'requires_media' => true,
            'publisher' => InstagramPublisher::class,
        ],
    ],
];
