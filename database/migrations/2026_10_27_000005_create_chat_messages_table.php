<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('chat_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('conversation_id')->constrained()->cascadeOnDelete();
            $table->enum('direction', ['in', 'out']);
            $table->enum('sender_type', ['customer', 'staff', 'system']);
            $table->string('sender_name')->nullable();
            // * Provider message id; with the conversation it dedups inbound messages that are delivered twice.
            $table->string('external_message_id')->nullable();
            // * Browser-generated token per composer submit: a double submit maps to the same row, so it is sent once.
            $table->string('client_token', 64)->nullable();
            $table->text('body');
            $table->enum('send_status', ['sending', 'sent', 'unknown', 'failed'])->nullable();
            $table->text('error')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();

            $table->index(['conversation_id', 'id']);
            $table->unique(['conversation_id', 'external_message_id']);
            $table->unique(['conversation_id', 'client_token']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('chat_messages');
    }
};
