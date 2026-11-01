<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\Conversation;
use App\Models\Integration;
use App\Models\ZaloAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** * The `zalo_accounts` migration turns the single stored Zalo session into the first account (in-memory test database only). */
class ZaloAccountsMigrationTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = 'database/migrations/2026_10_31_000005_create_zalo_accounts_table.php';

    public function test_the_existing_session_and_conversations_become_the_first_account_and_a_rerun_changes_nothing(): void
    {
        $this->migrate('migrate:rollback');

        $integration = Integration::query()->create([
            'provider' => 'zalo',
            'status' => 'connected',
            'credentials' => ['cookie' => 'c', 'imei' => 'i', 'user_agent' => 'u'],
            'settings' => ['permissions' => ['receive', 'proactive'], 'fields' => ['group_mode' => 'all'], 'risk_acknowledged' => true],
            'meta' => ['zalo_account' => ['uid' => '1001', 'name' => 'Shop A'], 'bridge_state' => 'running', 'contacts_synced_at' => '2026-10-30T10:00:00+00:00'],
        ]);
        DB::table('conversations')->insert([
            ['id' => (string) Str::uuid7(), 'integration_id' => $integration->id, 'provider' => 'zalo', 'external_chat_id' => 'u1', 'type' => 'private', 'title' => 'A', 'unread_count' => 0, 'created_at' => now(), 'updated_at' => now()],
            ['id' => (string) Str::uuid7(), 'integration_id' => null, 'provider' => 'telegram', 'external_chat_id' => 'u1', 'type' => 'private', 'title' => 'T', 'unread_count' => 0, 'created_at' => now(), 'updated_at' => now()],
        ]);

        $this->migrate('migrate');

        $account = ZaloAccount::query()->sole();
        $this->assertSame('1001', $account->account_key);
        $this->assertSame('Shop A', $account->name);
        $this->assertSame(['cookie' => 'c', 'imei' => 'i', 'user_agent' => 'u'], $account->credentials);
        $this->assertSame(['receive', 'proactive'], $account->permissions);
        $this->assertSame('all', $account->group_mode);
        $this->assertSame('connected', $account->status);
        $this->assertNotNull($account->contacts_synced_at);

        $zalo = Conversation::query()->where('provider', 'zalo')->sole();
        $this->assertSame($account->id, $zalo->zalo_account_id);
        $this->assertSame($account->id, $zalo->account_scope);
        $this->assertSame(0, Conversation::query()->where('provider', 'telegram')->sole()->account_scope);

        // * Re-running up() (rollback of the schema is not needed to prove idempotence of the data step): same data, no second account.
        $this->migrate('migrate:rollback');
        $this->migrate('migrate');
        $this->assertSame(1, ZaloAccount::query()->count());
    }

    public function test_without_a_stored_session_nothing_is_created(): void
    {
        $this->migrate('migrate:rollback');
        Integration::query()->create(['provider' => 'zalo', 'status' => 'disconnected']);

        $this->migrate('migrate');

        $this->assertSame(0, ZaloAccount::query()->count());
    }

    private function migrate(string $command): void
    {
        Artisan::call($command, ['--path' => self::MIGRATION, '--force' => true]);
    }
}
