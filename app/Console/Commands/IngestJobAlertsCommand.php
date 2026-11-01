<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\Jobs\Alerts\JobAlertIngestor;
use Illuminate\Console\Command;

class IngestJobAlertsCommand extends Command
{
    protected $signature = 'jobs:ingest-alerts';

    protected $description = 'Read job-alert emails already cached by the Mail module (TopCV, Glints, VietnamWorks, TopDev, ...) into the Jobs page; read-only, no network';

    public function handle(JobAlertIngestor $ingestor): int
    {
        $result = $ingestor->run();
        $this->line("{$result['status']}: {$result['message']}");

        return self::SUCCESS;
    }
}
