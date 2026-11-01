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
            // * `facebook_personal`: unofficial personal-timeline posting by cookie (text only).
            $table->enum('provider', ['linkedin', 'facebook', 'facebook_personal', 'instagram'])->change();
        });
    }

    public function down(): void
    {
        // * Targets of the removed platform cannot stay under the narrower enum.
        DB::table('post_targets')->where('provider', 'facebook_personal')->delete();

        Schema::table('post_targets', function (Blueprint $table) {
            $table->enum('provider', ['linkedin', 'facebook', 'instagram'])->change();
        });
    }
};
