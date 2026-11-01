<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messenger_accounts', function (Blueprint $table) {
            // * Scopes ticked for this account (`receive`, `reply`, `proactive`); null = defaults (receive + reply on, proactive off).
            $table->json('permissions')->nullable()->after('status');
        });

        $this->backfill();
    }

    public function down(): void
    {
        Schema::table('messenger_accounts', function (Blueprint $table) {
            $table->dropColumn('permissions');
        });
    }

    // * Idempotent: accounts that still have no scopes inherit the ones ticked on the messenger integration (channel level until now).
    private function backfill(): void
    {
        $integration = DB::table('integrations')->where('provider', 'messenger')->first();
        $settings = $integration === null ? null : json_decode((string) $integration->settings, true);
        $permissions = is_array($settings) ? ($settings['permissions'] ?? null) : null;

        if (! is_array($permissions)) {
            return;
        }

        $valid = array_values(array_intersect(['receive', 'reply', 'proactive'], array_filter($permissions, 'is_string')));

        DB::table('messenger_accounts')
            ->where('integration_id', $integration->id)
            ->whereNull('permissions')
            ->update(['permissions' => json_encode($valid)]);
    }
};
