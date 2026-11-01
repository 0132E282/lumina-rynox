<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('job_postings', function (Blueprint $table) {
            // * Review flow done by hand: new → saved | skipped | approved → applied. Nothing is ever submitted to the job site.
            $table->string('application_status', 20)->default('new')->after('meta')->index();
            $table->timestamp('applied_at')->nullable()->after('application_status');
            $table->string('note', 1000)->nullable()->after('applied_at');
        });
    }

    public function down(): void
    {
        Schema::table('job_postings', function (Blueprint $table) {
            $table->dropIndex(['application_status']);
            $table->dropColumn(['application_status', 'applied_at', 'note']);
        });
    }
};
