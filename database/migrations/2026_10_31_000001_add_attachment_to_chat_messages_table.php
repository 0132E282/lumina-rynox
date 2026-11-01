<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_messages', function (Blueprint $table) {
            // * One inbound image per message. `attachment_path` is a server-generated path on the private `local` disk, never a sender-supplied name.
            $table->string('attachment_path')->nullable()->after('body');
            $table->string('attachment_mime', 50)->nullable()->after('attachment_path');
            $table->unsignedInteger('attachment_size')->nullable()->after('attachment_mime');
            $table->unsignedInteger('attachment_width')->nullable()->after('attachment_size');
            $table->unsignedInteger('attachment_height')->nullable()->after('attachment_width');
        });
    }

    public function down(): void
    {
        Schema::table('chat_messages', function (Blueprint $table) {
            $table->dropColumn(['attachment_path', 'attachment_mime', 'attachment_size', 'attachment_width', 'attachment_height']);
        });
    }
};
