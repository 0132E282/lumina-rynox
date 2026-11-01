<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // * Per-admin chat customisation: extra instructions, how the AI addresses the person, the assistant's name and avatar (picked from a fixed list).
        Schema::create('ai_chat_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained('admins')->cascadeOnDelete();
            $table->text('custom_instructions')->nullable();
            $table->string('display_name', 60)->nullable();
            $table->string('assistant_name', 40)->nullable();
            $table->string('assistant_icon', 32)->nullable();
            $table->string('assistant_color', 32)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_chat_settings');
    }
};
