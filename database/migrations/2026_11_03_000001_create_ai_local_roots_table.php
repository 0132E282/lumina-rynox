<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // * Local folders a person imported from the UI. A "project" is the rows sharing `project`; `key` is the root id the rest of the app uses. Always scoped by `user_id`.
        Schema::create('ai_local_roots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('admins')->cascadeOnDelete();
            $table->string('project', 60);
            $table->string('key', 40);
            $table->string('path', 500);
            $table->timestamps();

            $table->unique(['user_id', 'key']);
            $table->index(['user_id', 'project']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_local_roots');
    }
};
