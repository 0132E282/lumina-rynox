<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // * A GitHub repo (`owner/name`) an admin added to the Code tab's project list; GitHub repos that were not added never show there.
        Schema::create('ai_projects', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('admins')->cascadeOnDelete();
            $table->string('repo', 201);
            $table->timestamps();

            $table->unique(['user_id', 'repo']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_projects');
    }
};
