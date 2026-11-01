<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('job_postings', function (Blueprint $table) {
            $table->id();
            // * Integration provider key: `topcv` | `itviec`.
            $table->string('source', 20);
            // * The site's own id (ITviec: the slug in the job URL).
            $table->string('external_id')->nullable();
            // * Public job URL without tracking parameters; with `source` it identifies the posting, so re-crawling updates in place.
            $table->string('url', 500);
            $table->string('title');
            $table->string('company')->nullable();
            $table->string('location')->nullable();
            // * Null when the site hides the salary from visitors who are not signed in.
            $table->string('salary_text')->nullable();
            $table->json('tags')->nullable();
            // * Taken from a relative "6 hours ago" on first sight; null when the site gives no usable date.
            $table->timestamp('posted_at')->nullable();
            $table->timestamp('first_seen_at');
            $table->timestamp('last_seen_at');
            // * Small extras only (e.g. `super_hot`); never page HTML.
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->unique(['source', 'url']);
            $table->index(['source', 'first_seen_at']);
            $table->index('last_seen_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('job_postings');
    }
};
