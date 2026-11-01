<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\File;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

class PullFilesCommand extends Command
{
    // * Skips files that already exist locally and files uploaded by system admins.
    protected $signature = 'files:pull
        {--force : Re-download files that already exist locally}';

    protected $description = 'Download files (by their stored full_path) from a remote environment to local storage';

    public function handle(): int
    {
        $files = File::files()
            ->whereNotNull('full_path')
            ->whereDoesntHave('creator', fn ($query) => $query->where('system_admin', true))
            ->get();

        if ($files->isEmpty()) {
            $this->info('No files to pull.');

            return self::SUCCESS;
        }

        $disk = Storage::disk('public');
        $bar = $this->output->createProgressBar($files->count());
        $pulled = 0;
        $skipped = 0;
        $failed = 0;

        foreach ($files as $file) {
            if (! $this->option('force') && $disk->exists($file->path)) {
                $skipped++;
                $bar->advance();

                continue;
            }

            $response = Http::timeout(30)->get($file->full_path);

            if (! $response->successful()) {
                $failed++;
                $this->newLine();
                $this->warn("Failed to fetch [{$file->full_path}] for file #{$file->id}: HTTP {$response->status()}");
                $bar->advance();

                continue;
            }

            $directory = dirname($file->path);

            if ($directory !== '.' && ! $disk->exists($directory)) {
                $disk->makeDirectory($directory);
            }

            $disk->put($file->path, $response->body());
            $pulled++;
            $bar->advance();
        }

        $bar->finish();
        $this->newLine(2);
        $this->info("Pulled: {$pulled}  Skipped (already local): {$skipped}  Failed: {$failed}");

        return self::SUCCESS;
    }
}
