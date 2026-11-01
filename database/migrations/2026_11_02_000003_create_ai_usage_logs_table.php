<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // * One row per real AI call: which account and model, for whom and what it ended in. Never the prompt, the answer or the vendor's own error text.
        Schema::create('ai_usage_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ai_account_id')->nullable()->constrained('ai_accounts')->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->string('purpose', 40);
            $table->string('model', 100)->nullable();
            // * `ok|error|quota`; `error_kind` is a short class of the failure (see AiException::kind), null on success.
            $table->string('status', 10);
            $table->string('error_kind', 30)->nullable();
            // * Estimates (about 4 characters per token) made from the text length at call time; the text itself is never kept. Null on rows from before this existed, `tokens_out` also null when the call failed.
            $table->unsignedInteger('tokens_in')->nullable();
            $table->unsignedInteger('tokens_out')->nullable();
            // * Only for a `quota` row, and only what the real error stated: `day|week` and the reset time. Null when the error did not say. Never the error text.
            $table->string('limit_scope', 10)->nullable();
            $table->timestamp('limit_reset_at')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['ai_account_id', 'created_at']);
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_usage_logs');
    }
};
