<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // * A question asked in a comment box under code opens a child session of the chat it was asked from: it stays out of the chat list and goes with its parent when that is deleted.
        if (Schema::hasColumn('ai_conversations', 'parent_id')) {
            return;
        }

        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->foreignId('parent_id')->nullable()->after('repo')->constrained('ai_conversations')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_id');
        });
    }
};
