<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('integrations', function (Blueprint $table) {
            $table->id();
            $table->string('provider')->unique();
            $table->enum('status', ['connected', 'error', 'disconnected'])->default('disconnected');
            // * Encrypted by the model cast (`encrypted:array`); never serialized to the client.
            $table->text('credentials')->nullable();
            $table->json('settings')->nullable();
            $table->json('meta')->nullable();
            $table->timestamp('last_checked_at')->nullable();
            $table->text('last_error')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('integrations');
    }
};
