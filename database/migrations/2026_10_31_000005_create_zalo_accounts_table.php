<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('zalo_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('integration_id')->constrained()->cascadeOnDelete();
            // * The Zalo uid: the key the sidecar uses for this account's session.
            $table->string('account_key', 64)->unique();
            $table->string('name')->nullable();
            // * Session of this account only (cookie, imei, user agent), encrypted by the model cast; hidden from every response.
            $table->longText('credentials')->nullable();
            $table->enum('status', ['connected', 'error', 'disconnected'])->default('disconnected');
            // * Scopes ticked for this account (`receive`, `reply`, `proactive`); null = defaults (receive + reply on, proactive off).
            $table->json('permissions')->nullable();
            // * `mention_only` (default), `all` or `off`; null = default.
            $table->string('group_mode', 20)->nullable();
            $table->text('last_error')->nullable();
            $table->string('bridge_state', 50)->nullable();
            $table->timestamp('bridge_state_at')->nullable();
            $table->timestamp('connected_at')->nullable();
            $table->timestamp('contacts_synced_at')->nullable();
            $table->timestamps();
        });

        Schema::table('conversations', function (Blueprint $table) {
            $table->foreignId('zalo_account_id')->nullable()->after('messenger_account_id')->constrained('zalo_accounts')->nullOnDelete();
            // * Part of the unique key: the same Zalo friend or group can have one conversation per account. 0 = not tied to a Zalo account
            // * (Telegram, Messenger), so those channels keep a plain unique (provider, external_chat_id) without a nullable column in the key.
            $table->unsignedBigInteger('account_scope')->default(0)->after('zalo_account_id');
        });

        Schema::table('conversations', function (Blueprint $table) {
            $table->dropUnique(['provider', 'external_chat_id']);
            $table->unique(['provider', 'external_chat_id', 'account_scope']);
        });

        $this->backfill();
    }

    public function down(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            $table->dropUnique(['provider', 'external_chat_id', 'account_scope']);
        });

        // * Two accounts' conversations with the same contact cannot share the old unique key: keep the oldest of each pair (UUID v7 ids sort by creation time, so `<` still means older).
        DB::table('conversations')
            ->whereNotNull('zalo_account_id')
            ->whereIn('id', fn ($query) => $query->select('duplicate.id')->from('conversations as duplicate')
                ->join('conversations as original', fn ($join) => $join
                    ->on('original.provider', '=', 'duplicate.provider')
                    ->on('original.external_chat_id', '=', 'duplicate.external_chat_id')
                    ->whereColumn('original.id', '<', 'duplicate.id')))
            ->delete();

        Schema::table('conversations', function (Blueprint $table) {
            $table->unique(['provider', 'external_chat_id']);
            $table->dropConstrainedForeignId('zalo_account_id');
            $table->dropColumn('account_scope');
        });

        Schema::dropIfExists('zalo_accounts');
    }

    // * Idempotent: the single Zalo session kept on the integration becomes the first account. The integration's own credentials are left in place.
    private function backfill(): void
    {
        $integration = DB::table('integrations')->where('provider', 'zalo')->first();

        if ($integration === null) {
            return;
        }

        $meta = json_decode((string) $integration->meta, true);
        $settings = json_decode((string) $integration->settings, true);
        $uid = is_array($meta) ? ($meta['zalo_account']['uid'] ?? null) : null;

        if (! is_string($uid) || $uid === '') {
            return;
        }

        $permissions = is_array($settings) ? ($settings['permissions'] ?? null) : null;
        $groupMode = is_array($settings) ? ($settings['fields']['group_mode'] ?? null) : null;
        $accountId = DB::table('zalo_accounts')->where('account_key', $uid)->value('id');
        $now = now();

        $accountId ??= DB::table('zalo_accounts')->insertGetId([
            'integration_id' => $integration->id,
            'account_key' => $uid,
            'name' => is_string($meta['zalo_account']['name'] ?? null) ? $meta['zalo_account']['name'] : null,
            // * Same `encrypted:array` format on both tables, so the stored value is copied as is.
            'credentials' => $integration->credentials,
            'status' => $integration->credentials === null ? 'disconnected' : $integration->status,
            'permissions' => is_array($permissions) ? json_encode(array_values(array_intersect(['receive', 'reply', 'proactive'], array_filter($permissions, 'is_string')))) : null,
            'group_mode' => in_array($groupMode, ['mention_only', 'all', 'off'], true) ? $groupMode : null,
            'last_error' => $integration->last_error,
            'bridge_state' => is_string($meta['bridge_state'] ?? null) ? $meta['bridge_state'] : null,
            'bridge_state_at' => is_string($meta['bridge_state_at'] ?? null) ? date('Y-m-d H:i:s', (int) strtotime($meta['bridge_state_at'])) : null,
            'connected_at' => $integration->last_checked_at,
            'contacts_synced_at' => is_string($meta['contacts_synced_at'] ?? null) ? date('Y-m-d H:i:s', (int) strtotime($meta['contacts_synced_at'])) : null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::table('conversations')
            ->where('provider', 'zalo')
            ->whereNull('zalo_account_id')
            ->update(['zalo_account_id' => $accountId, 'account_scope' => $accountId]);
    }
};
