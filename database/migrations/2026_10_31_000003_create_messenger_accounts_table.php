<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('messenger_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('integration_id')->constrained()->cascadeOnDelete();
            $table->string('login_id')->unique();
            $table->string('remote_id')->nullable();
            $table->string('name')->nullable();
            $table->string('avatar_path')->nullable();
            $table->string('avatar_mxc')->nullable();
            $table->enum('status', ['connected', 'error', 'disconnected'])->default('disconnected');
            $table->text('last_error')->nullable();
            $table->string('bridge_state', 50)->nullable();
            $table->timestamp('bridge_state_at')->nullable();
            $table->timestamp('connected_at')->nullable();
            $table->timestamps();
        });

        Schema::table('conversations', function (Blueprint $table) {
            $table->foreignId('messenger_account_id')->nullable()->after('integration_id')->constrained('messenger_accounts')->nullOnDelete();
        });

        $this->backfill();
    }

    public function down(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('messenger_account_id');
        });

        Schema::dropIfExists('messenger_accounts');
    }

    private function backfill(): void
    {
        $integration = DB::table('integrations')->where('provider', 'messenger')->first();
        $meta = $integration === null ? null : json_decode((string) $integration->meta, true);
        $loginId = is_array($meta) ? ($meta['login_id'] ?? null) : null;

        if (! is_string($loginId) || $loginId === '') {
            return;
        }

        $accountId = DB::table('messenger_accounts')->where('login_id', $loginId)->value('id');
        $now = now();

        $accountId ??= DB::table('messenger_accounts')->insertGetId([
            'integration_id' => $integration->id,
            'login_id' => $loginId,
            'remote_id' => is_string($meta['remote_id'] ?? null) && $meta['remote_id'] !== '' ? $meta['remote_id'] : $loginId,
            'name' => is_string($meta['account_name'] ?? null) ? $meta['account_name'] : null,
            'status' => $integration->status,
            'last_error' => $integration->last_error,
            'bridge_state' => is_string($meta['bridge_state'] ?? null) ? $meta['bridge_state'] : null,
            'bridge_state_at' => is_string($meta['bridge_state_at'] ?? null) ? date('Y-m-d H:i:s', (int) strtotime($meta['bridge_state_at'])) : null,
            'connected_at' => is_string($meta['connected_at'] ?? null) ? date('Y-m-d H:i:s', (int) strtotime($meta['connected_at'])) : null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::table('conversations')
            ->where('provider', 'messenger')
            ->whereNull('messenger_account_id')
            ->update(['messenger_account_id' => $accountId]);
    }
};
