<?php

use App\Services\Jobs\CareerVietCrawler;
use App\Services\Jobs\ItviecCrawler;
use App\Services\Jobs\TopCvCrawler;

// * Public job crawling (`/jobs`, `php artisan jobs:crawl`). Only public pages, no login; robots.txt is honoured and a block
// * (403/429/captcha) stops that source instead of being worked around.
return [
    // * Identifies the bot honestly; sites can block or contact the operator by this string.
    'user_agent' => 'PersonalManagerJobBot/1.0 (personal job search; no login, honours robots.txt)',

    'http_timeout_seconds' => 15,

    // * Pause between two requests to the same site.
    'delay_milliseconds' => 2000,

    // * Per keyword and per source; a run never exceeds `max_keywords * max_pages` search requests.
    'max_pages' => 2,
    'max_keywords' => 3,

    // * After a block (403/429/captcha) the source is not contacted again until this many hours passed.
    'blocked_cooldown_hours' => 24,

    // * Sources with a crawler. Each is only switched on or off on the "Nơi tìm việc" page; the keywords come from the CV.
    'sources' => [
        'topcv' => ['crawler' => TopCvCrawler::class, 'base_url' => 'https://www.topcv.vn', 'name' => 'TopCV', 'letter' => 'T', 'color' => '#00b14f'],
        'itviec' => ['crawler' => ItviecCrawler::class, 'base_url' => 'https://itviec.com', 'name' => 'ITviec', 'letter' => 'I', 'color' => '#ed1b2f'],
        'careerviet' => ['crawler' => CareerVietCrawler::class, 'base_url' => 'https://careerviet.vn', 'name' => 'CareerViet', 'letter' => 'C', 'color' => '#e8710a'],
    ],

    // * AI match of new jobs against the default CV, right after a crawl. Only `sources` (public pages we may open again for the detail page)
    // * are read; a job below `threshold` percent is set aside as skipped, the rest stays as a new job with the extracted details.
    'match' => [
        'sources' => ['itviec', 'careerviet'],
        'threshold' => 70,
        'max_per_run' => 10,
        // * false: each posting's scoring job runs in place, one after the other (no worker). true: queued one per posting; needs `php artisan queue:work`.
        'queued' => (bool) env('JOBS_MATCH_QUEUED', false),
        'cv_chars' => 6000,
        'job_chars' => 8000,
    ],

    // * Job-alert e-mails already cached by the Mail module (`php artisan jobs:ingest-alerts`). Read-only: no network, no sending,
    // * nothing is changed on the mail server. These sites block crawlers, so their own alert mails are the supported source.
    // ! The `job_path` patterns come from the public URL shape of each site, NOT from a real alert mail (none was available on
    // ! 2026-10-27): verify them against a real mail before relying on a source.
    'alerts' => [
        // * Only mails received in the last N days, newest `max_messages` per run (re-reading a mail is harmless: upsert is idempotent).
        'lookback_days' => 14,
        'max_messages' => 200,

        // * Query parameters that hold the real destination of a click-tracking link (only unwrapped when it lands on `link_hosts`).
        'redirect_params' => ['url', 'u', 'redirect', 'redirect_url', 'redirect_uri', 'target', 'link', 'dest', 'destination'],

        // * Links whose URL contains one of these are never job links.
        'ignored_link_words' => ['unsubscribe', 'opt-out', 'optout', 'preferences', 'manage-subscription', 'email-settings', 'huy-dang-ky'],

        // * Key = `job_postings.source`. `sender_domains` identify the mail (exact or sub-domain of the From address);
        // * `link_hosts` are the only hosts a job link may point to; `job_path` is matched on the cleaned URL path.
        'sources' => [
            'topcv' => ['name' => 'TopCV', 'letter' => 'T', 'color' => '#00b14f', 'sender_domains' => ['topcv.vn'], 'link_hosts' => ['topcv.vn'], 'job_path' => '#^/(?:[a-z-]+/)*viec-lam/[^/]+/\d+(?:\.html)?$#i'],
            'glints' => ['name' => 'Glints', 'letter' => 'G', 'color' => '#e8212c', 'sender_domains' => ['glints.com'], 'link_hosts' => ['glints.com'], 'job_path' => '#/opportunities/jobs/[^/]+(?:/[^/]+)?$#i'],
            'vietnamworks' => ['name' => 'VietnamWorks', 'letter' => 'V', 'color' => '#1f5eff', 'sender_domains' => ['vietnamworks.com'], 'link_hosts' => ['vietnamworks.com'], 'job_path' => '#-\d+-jv$#i'],
            'topdev' => ['name' => 'TopDev', 'letter' => 'D', 'color' => '#e5322d', 'sender_domains' => ['topdev.vn'], 'link_hosts' => ['topdev.vn'], 'job_path' => '#^/(?:detail-jobs|viec-lam)/[^/]+-\d+$#i'],
            'itviec' => ['name' => 'ITviec', 'letter' => 'I', 'color' => '#ed1b2f', 'sender_domains' => ['itviec.com'], 'link_hosts' => ['itviec.com'], 'job_path' => '#^/it-jobs/[^/]+$#i'],
            'careerviet' => ['name' => 'CareerViet', 'letter' => 'C', 'color' => '#0b5cab', 'sender_domains' => ['careerviet.vn'], 'link_hosts' => ['careerviet.vn'], 'job_path' => '#/tim-viec-lam/[^/]+\.\d+\.html$#i'],
        ],
    ],
];
