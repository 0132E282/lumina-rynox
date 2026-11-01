<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('social_groups', function (Blueprint $table) {
            // * Set when a sync no longer finds the group (the account left it); cleared when a later sync sees it again. The row is kept for its posts.
            $table->timestamp('left_at')->nullable()->after('synced_at');
        });
    }

    public function down(): void
    {
        Schema::table('social_groups', function (Blueprint $table) {
            $table->dropColumn('left_at');
        });
    }
};
