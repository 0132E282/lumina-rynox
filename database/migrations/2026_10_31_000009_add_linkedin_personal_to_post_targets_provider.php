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
            // * `linkedin_personal`: unofficial personal-feed posting through a real Chrome (text and images).
            // * `audience` stays string(16) default 'self': 'connections' fits, and the controller always stores each platform's own value.
            $table->enum('provider', ['linkedin', 'facebook', 'facebook_personal', 'linkedin_personal', 'instagram'])->change();
        });
    }

    public function down(): void
    {
        // * Targets of the removed platform cannot stay under the narrower enum.
        DB::table('post_targets')->where('provider', 'linkedin_personal')->delete();

        Schema::table('post_targets', function (Blueprint $table) {
            $table->enum('provider', ['linkedin', 'facebook', 'facebook_personal', 'instagram'])->change();
        });
    }
};
