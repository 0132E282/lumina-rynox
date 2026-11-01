<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('social_groups', function (Blueprint $table) {
            // * Group picture read during sync; the platform's CDN links expire, so a new sync refreshes it.
            $table->string('image_url', 2048)->nullable()->after('url');
        });
    }

    public function down(): void
    {
        Schema::table('social_groups', function (Blueprint $table) {
            $table->dropColumn('image_url');
        });
    }
};
