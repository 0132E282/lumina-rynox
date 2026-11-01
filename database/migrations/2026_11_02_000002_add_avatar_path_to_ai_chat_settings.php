<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // * Path (on the private disk) of the uploaded assistant avatar; never sent to the client, which only gets the route that serves it.
        Schema::table('ai_chat_settings', function (Blueprint $table) {
            $table->string('avatar_path', 120)->nullable()->after('assistant_color');
        });
    }

    public function down(): void
    {
        Schema::table('ai_chat_settings', function (Blueprint $table) {
            $table->dropColumn('avatar_path');
        });
    }
};
