<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // * The table was first created without these columns; a database that already ran the create migration never got them, so no usage row could be saved. Each column is added only when missing.
    public function up(): void
    {
        Schema::table('ai_usage_logs', function (Blueprint $table) {
            if (! Schema::hasColumn('ai_usage_logs', 'tokens_in')) {
                $table->unsignedInteger('tokens_in')->nullable()->after('error_kind');
            }

            if (! Schema::hasColumn('ai_usage_logs', 'tokens_out')) {
                $table->unsignedInteger('tokens_out')->nullable()->after('tokens_in');
            }

            if (! Schema::hasColumn('ai_usage_logs', 'limit_scope')) {
                $table->string('limit_scope', 10)->nullable()->after('tokens_out');
            }

            if (! Schema::hasColumn('ai_usage_logs', 'limit_reset_at')) {
                $table->timestamp('limit_reset_at')->nullable()->after('limit_scope');
            }
        });
    }

    public function down(): void
    {
        // * Nothing to undo: on a fresh database these columns belong to the create migration.
    }
};
