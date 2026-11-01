<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('post_targets', function (Blueprint $table) {
            // * A target with a group posts into that saved group; without one it is the usual feed/page post. Deleting a saved group
            // * drops its targets (never turns them into feed posts).
            $table->foreignId('social_group_id')->nullable()->after('provider')->constrained('social_groups')->cascadeOnDelete();

            // * Added before the old key is dropped: on MySQL the `post_id` foreign key needs an index at every moment.
            // * One target per (post, provider, group). `social_group_id` NULL repeats are allowed by SQL, so the feed target stays
            // * unique through PostController (updateOrCreate on provider + NULL group).
            $table->unique(['post_id', 'provider', 'social_group_id'], 'post_targets_post_provider_group_unique');
            $table->dropUnique(['post_id', 'provider']);
        });
    }

    public function down(): void
    {
        // * Group targets cannot stay under the old one-per-provider key.
        DB::table('post_targets')->whereNotNull('social_group_id')->delete();

        Schema::table('post_targets', function (Blueprint $table) {
            $table->unique(['post_id', 'provider']);
            $table->dropUnique('post_targets_post_provider_group_unique');
            $table->dropConstrainedForeignId('social_group_id');
        });
    }
};
