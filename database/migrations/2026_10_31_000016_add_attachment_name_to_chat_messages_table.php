<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_messages', function (Blueprint $table) {
            // * Original file name of a file staff sent (shown as the download label); null for images and for inbound pictures.
            $table->string('attachment_name')->nullable()->after('attachment_height');
        });
    }

    public function down(): void
    {
        Schema::table('chat_messages', function (Blueprint $table) {
            $table->dropColumn('attachment_name');
        });
    }
};
