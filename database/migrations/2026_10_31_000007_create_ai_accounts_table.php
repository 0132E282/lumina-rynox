<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_accounts', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            // * `anthropic|openai|google|deepseek`; `auth_type` is `api_token` (HTTP API) or `session_token` (vendor CLI login session).
            $table->string('vendor', 20);
            $table->string('auth_type', 20);
            // * Encrypted array `{token}` (model cast `encrypted:array`); hidden from every response.
            $table->text('credentials')->nullable();
            $table->string('model')->nullable();
            $table->boolean('enabled')->default(true);
            // * `connected|error|disconnected`; `last_error` is always one of the fixed `AiException` texts.
            $table->string('status', 20)->default('connected');
            $table->text('last_error')->nullable();
            $table->timestamp('last_checked_at')->nullable();
            // * JSON list of `suggest_reply|report|post_draft|ask`; null = every purpose.
            $table->json('purposes')->nullable();
            // * Lower runs first; the next enabled account is tried when one fails.
            $table->unsignedInteger('priority')->default(100);
            $table->timestamps();

            $table->index(['enabled', 'priority']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_accounts');
    }
};
