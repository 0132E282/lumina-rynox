<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\Posting\SocialGroupException;
use App\Services\Posting\SocialGroupSync;
use Illuminate\Console\Command;

class SyncSocialGroupsCommand extends Command
{
    protected $signature = 'groups:sync {provider : facebook_personal or linkedin_personal}';

    protected $description = 'Read the groups the personal Facebook/LinkedIn account joined (real Chrome, read-only) and save them.';

    public function handle(SocialGroupSync $sync): int
    {
        $provider = (string) $this->argument('provider');

        if (! in_array($provider, SocialGroupSync::PROVIDERS, true)) {
            $this->error('Provider must be one of: '.implode(', ', SocialGroupSync::PROVIDERS));

            return self::INVALID;
        }

        try {
            $result = $sync->sync($provider);
        } catch (SocialGroupException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->info("Saved {$result['synced']} group(s); {$result['total']} in total.");

        return self::SUCCESS;
    }
}
