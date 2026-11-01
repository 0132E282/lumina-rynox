<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // * Office types are long (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` is 65 characters).
    public function up(): void
    {
        Schema::table('chat_messages', function (Blueprint $table) {
            $table->string('attachment_mime', 127)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('chat_messages', function (Blueprint $table) {
            $table->string('attachment_mime', 50)->nullable()->change();
        });
    }
};
