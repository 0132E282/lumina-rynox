<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cvs', function (Blueprint $table) {
            // * The uploaded CV file, kept on the private disk (`cvs/<random>.<ext>`) so it can be attached to an application later.
            $table->string('file_path')->nullable()->after('file_url');
        });
    }

    public function down(): void
    {
        Schema::table('cvs', function (Blueprint $table) {
            $table->dropColumn('file_path');
        });
    }
};
