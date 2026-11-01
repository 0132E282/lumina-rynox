<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Spatie\Permission\Models\Permission;

class GeneratePermissionsCommand extends Command
{
    // ! Add every new manageable resource here.
    private const RESOURCES = [
        'admins' => ['view', 'create', 'update', 'delete'],
        'roles' => ['view', 'create', 'update', 'delete'],
        'file-manager' => ['view', 'upload', 'delete'],
        'settings' => ['view', 'update'],
        'integrations' => ['view', 'update'],
        'tasks' => ['view', 'create', 'update', 'delete'],
        'events' => ['view', 'create', 'update', 'delete'],
        'conversations' => ['view', 'reply'],
        'posts' => ['view', 'create', 'update', 'delete', 'publish'],
        'jobs' => ['view', 'update'],
        'cvs' => ['view', 'create', 'update', 'delete'],
        'mail' => ['view', 'send'],
        'ai' => ['use', 'local-read', 'local-write'],
    ];

    protected $signature = 'permissions:generate
        {--fresh : Remove permissions that are no longer declared in RESOURCES before generating}';

    protected $description = 'Auto-generate the full permission set (resource.action) for every manageable resource';

    public function handle(): int
    {
        $guard = 'web';
        $created = 0;
        $existing = 0;
        $names = [];

        foreach (self::RESOURCES as $resource => $actions) {
            foreach ($actions as $action) {
                $name = "{$resource}.{$action}";
                $names[] = $name;

                $permission = Permission::firstOrCreate(['name' => $name, 'guard_name' => $guard]);

                $permission->wasRecentlyCreated ? $created++ : $existing++;
            }
        }

        if ($this->option('fresh')) {
            $removed = Permission::query()
                ->where('guard_name', $guard)
                ->whereNotIn('name', $names)
                ->get();

            $removed->each->delete();

            if ($removed->isNotEmpty()) {
                $this->warn("Removed {$removed->count()} stale permission(s): ".$removed->pluck('name')->implode(', '));
            }
        }

        $this->info("Permissions ready: {$created} created, {$existing} already existed (".count($names).' total).');

        return self::SUCCESS;
    }
}
