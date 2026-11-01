<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // * `owner/name` of the GitHub repo a chat was held about (null for a general chat): groups the chats under their project.
        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->string('repo', 140)->nullable()->after('title');
        });
    }

    public function down(): void
    {
        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->dropColumn('repo');
        });
    }
};
