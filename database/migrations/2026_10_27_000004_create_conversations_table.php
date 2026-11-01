<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversations', function (Blueprint $table) {
            // * UUID (v7, time-ordered) so ids are not guessable and never collide across environments.
            $table->uuid('id')->primary();
            $table->foreignId('integration_id')->nullable()->constrained()->nullOnDelete();
            $table->string('provider');
            $table->string('external_chat_id');
            $table->enum('type', ['private', 'group'])->default('private');
            $table->string('title');
            $table->string('username')->nullable();
            // * Denormalised from the latest message so the list needs no per-row query.
            $table->string('last_message_preview')->nullable();
            $table->enum('last_message_direction', ['in', 'out'])->nullable();
            $table->timestamp('last_message_at')->nullable();
            $table->unsignedInteger('unread_count')->default(0);
            // * Global pin (shared by all staff): pinned conversations always sort first.
            $table->timestamp('pinned_at')->nullable();
            $table->timestamps();

            $table->unique(['provider', 'external_chat_id']);
            $table->index('last_message_at');
            $table->index('pinned_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('conversations');
    }
};
