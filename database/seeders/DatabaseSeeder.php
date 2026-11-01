<?php

namespace Database\Seeders;

use App\Models\Admin;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        Artisan::call('permissions:generate');

        $adminEmails = array_filter(array_map('trim', explode(',', config('cms.system_admin', 'admin@admin.com'))));

        foreach ($adminEmails as $email) {
            if (! Admin::where('email', $email)->exists()) {
                Admin::factory()->create([
                    'name' => 'System Admin',
                    'email' => $email,
                    'password' => Hash::make($email),
                    'system_admin' => true,
                ]);
            }
        }
    }
}
