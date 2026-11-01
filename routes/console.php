<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// * Needs the Laravel scheduler running (`php artisan schedule:run` every minute, or `schedule:work`).
Schedule::command('events:send-reminders')->everyMinute()->withoutOverlapping();

// * Publishes due scheduled posts; stale ones become "missed" (see config/posting.php). Same scheduler requirement as above.
Schedule::command('posts:publish-due')->everyMinute()->withoutOverlapping();

// * Syncs due mailboxes (INBOX + Sent) into the local cache; each mailbox has its own interval, lock and refused-password stop (see MailSync).
// * Same scheduler requirement as above. Remove this line to pause mail sync; no data is lost.
Schedule::command('mail:sync')->everyMinute()->withoutOverlapping();

// * Reads public TopCV/ITviec listings (see config/jobs.php); a blocked source rests for `jobs.blocked_cooldown_hours`.
Schedule::command('jobs:crawl')->everyFourHours()->withoutOverlapping();

// * Reads job-alert mails already cached by `mail:sync` (TopCV/Glints/VietnamWorks/TopDev...) into /jobs; no network, mail untouched.
Schedule::command('jobs:ingest-alerts')->everyThreeHours()->withoutOverlapping();

// * Messenger personal channel (unofficial, see docs/repo/messenger-mautrix-runbook.md): one `/sync` call per minute, so new
// * messages can take up to ~1 minute to appear. The command itself skips the request when not configured/connected.
// * Same scheduler requirement as above (`schedule:run`/`schedule:work`).
Schedule::command('chat:matrix-sync --once')->everyMinute()->withoutOverlapping();

// * Daily AI report (yesterday's numbers + AI summary) to `report_conversation_id` of the `ai` integration, at 08:00 personal time. Drafts for customers are never sent by AI.
// * Same scheduler requirement as above. The CLI mode needs this machine signed in, so prefer API mode for this background job.
Schedule::command('ai:send-report')->dailyAt('08:00')->timezone(config('cms.personal_timezone'))->withoutOverlapping();

// * Recovers the media link of voice messages saved before they were supported; a no-op once none is left.
Schedule::command('chat:backfill-voice')->everyMinute()->withoutOverlapping();
