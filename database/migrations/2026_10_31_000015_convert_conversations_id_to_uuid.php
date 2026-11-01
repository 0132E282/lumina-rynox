<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        // * Fresh databases already create `conversations.id` as a UUID; only a table made before the switch still has the integer key.
        if (! $this->hasIntegerKey() || DB::getDriverName() !== 'mysql') {
            return;
        }

        Schema::table('chat_messages', function (Blueprint $table) {
            $table->dropForeign(['conversation_id']);
            $table->dropUnique(['conversation_id', 'external_message_id']);
            $table->dropUnique(['conversation_id', 'client_token']);
            $table->dropIndex(['conversation_id', 'id']);
            $table->char('new_conversation_id', 36)->nullable();
        });
        Schema::table('conversations', function (Blueprint $table) {
            $table->char('new_id', 36)->nullable();
        });

        // * Same time-ordered UUIDs the model generates for new rows; messages follow their conversation through the old key.
        DB::table('conversations')->orderBy('id')->each(fn (object $row) => DB::table('conversations')->where('id', $row->id)->update(['new_id' => (string) Str::uuid7()]));
        DB::statement('UPDATE chat_messages JOIN conversations ON conversations.id = chat_messages.conversation_id SET chat_messages.new_conversation_id = conversations.new_id');

        DB::statement('ALTER TABLE conversations MODIFY id BIGINT UNSIGNED NOT NULL');
        DB::statement('ALTER TABLE conversations DROP PRIMARY KEY, DROP COLUMN id');
        DB::statement('ALTER TABLE conversations CHANGE new_id id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (id)');

        DB::statement('ALTER TABLE chat_messages DROP COLUMN conversation_id');
        DB::statement('ALTER TABLE chat_messages CHANGE new_conversation_id conversation_id CHAR(36) NOT NULL AFTER id');

        Schema::table('chat_messages', function (Blueprint $table) {
            $table->foreign('conversation_id')->references('id')->on('conversations')->cascadeOnDelete();
            $table->index(['conversation_id', 'id']);
            $table->unique(['conversation_id', 'external_message_id']);
            $table->unique(['conversation_id', 'client_token']);
        });
    }

    public function down(): void
    {
        // * One-way: the integer ids are gone once converted.
    }

    private function hasIntegerKey(): bool
    {
        foreach (Schema::getColumns('conversations') as $column) {
            if ($column['name'] === 'id') {
                return str_contains(strtolower($column['type_name']), 'int');
            }
        }

        return false;
    }
};
