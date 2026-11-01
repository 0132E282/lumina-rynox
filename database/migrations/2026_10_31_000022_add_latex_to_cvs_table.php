<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cvs', function (Blueprint $table) {
            // * The CV as LaTeX source. `latex_hash` is the sha1 of the last text the AI wrote, so a later AI refresh never overwrites a text the person edited.
            $table->longText('latex')->nullable()->after('content');
            $table->string('latex_hash', 40)->nullable()->after('latex');
        });
    }

    public function down(): void
    {
        Schema::table('cvs', function (Blueprint $table) {
            $table->dropColumn(['latex', 'latex_hash']);
        });
    }
};
