<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            // * Profile picture: server-generated path on the private `local` disk, plus the source mxc so it is only downloaded again when it changes.
            $table->string('avatar_path')->nullable();
            $table->string('avatar_mxc')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            $table->dropColumn(['avatar_path', 'avatar_mxc']);
        });
    }
};
