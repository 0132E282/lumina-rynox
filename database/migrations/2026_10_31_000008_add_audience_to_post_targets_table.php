<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('post_targets', function (Blueprint $table) {
            // * Per-post visibility (`self`|`friends`|`public`); only platforms that support it (facebook_personal) read it.
            $table->string('audience', 16)->default('self')->after('provider');
        });
    }

    public function down(): void
    {
        Schema::table('post_targets', function (Blueprint $table) {
            $table->dropColumn('audience');
        });
    }
};
