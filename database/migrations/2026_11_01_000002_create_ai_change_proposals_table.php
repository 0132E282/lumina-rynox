<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // * File edits the AI proposed in a chat answer. Nothing reaches GitHub until the person approves; then one branch + one pull request carries them.
        Schema::create('ai_change_proposals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ai_message_id')->constrained('ai_messages')->cascadeOnDelete();
            $table->string('repo', 140);
            $table->string('base_branch', 255);
            $table->string('path', 300);
            $table->string('action', 8); // create|update
            $table->string('base_sha', 64)->nullable(); // blob sha of the file being replaced (update only)
            $table->mediumText('content');
            $table->mediumText('diff')->nullable();
            $table->string('status', 12)->default('pending'); // pending|applied|rejected
            $table->string('pull_url', 255)->nullable();
            $table->timestamps();

            $table->index(['ai_message_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_change_proposals');
    }
};
