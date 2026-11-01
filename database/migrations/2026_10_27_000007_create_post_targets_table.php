<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('post_targets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('post_id')->constrained()->cascadeOnDelete();
            $table->enum('provider', ['linkedin', 'facebook', 'instagram']);
            // * `unknown`: the request timed out or the platform answered 5xx, so the post may exist. Never retried automatically.
            $table->enum('status', ['pending', 'publishing', 'published', 'failed', 'unknown'])->default('pending');
            $table->string('external_post_id')->nullable();
            $table->string('external_url', 2048)->nullable();
            $table->text('error')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamps();

            $table->unique(['post_id', 'provider']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('post_targets');
    }
};
